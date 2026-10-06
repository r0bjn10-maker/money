import { describe, it, expect } from 'vitest';
import { groupDebtsByPerson, type DebtWithBalance } from '../src/debt-groups';
import { db } from '../src/db';
import { saveWallet, saveTransaction, payDebt, payPersonDebt, getPersonDebtOverview, getBalances, trashTransaction } from '../src/services';
import { now } from '../src/finance';

const debt = (id: string, personName: string, remaining: number, extra: Partial<DebtWithBalance> = {}): DebtWithBalance => ({ id, personName, kind: 'lend', originalAmount: 100000, remaining, date: '2026-01-01', note: '', walletId: 'wallet', transactionId: id, status: '', ...extra });
describe('debts grouped by person', () => {
  it('combines paid and open loans into one person with exact aggregate amounts', () => {
    const groups = groupDebtsByPerson([debt('a', 'Người A', 0), debt('b', 'Người A', 50000)]);
    expect(groups).toHaveLength(1); expect(groups[0].originalAmount).toBe(200000); expect(groups[0].remaining).toBe(50000); expect(groups[0].debts.map(d => d.id)).toEqual(['a', 'b']); expect(groups[0].status).toBe('Đang mở');
  });
  it('normalizes spacing, case and Unicode while preserving different accented names', () => {
    const groups = groupDebtsByPerson([debt('a', '  Người   A  ', 100), debt('b', 'người a', 200), debt('c', 'Nguoi A', 300)]);
    expect(groups).toHaveLength(2); expect(groups.find(g => g.debts.length === 2)?.remaining).toBe(300);
  });
  it('keeps borrowing and lending to the same person in separate tabs', () => {
    const groups = groupDebtsByPerson([debt('a', 'Người A', 10000), debt('b', 'Người A', 30000, { kind: 'borrow' })]);
    expect(groups).toHaveLength(2); expect(groups.map(g => g.remaining).sort((a, b) => a - b)).toEqual([10000, 30000]);
  });
  it('ignores overdue dates on paid loans and reports overdue open portions', () => {
    const paid = debt('a', 'Người A', 0, { dueDate: '2026-01-01' });
    expect(groupDebtsByPerson([paid, debt('b', 'Người A', 50000)], '2026-10-06')[0].status).toBe('Đang mở');
    expect(groupDebtsByPerson([paid, debt('b', 'Người A', 50000, { dueDate: '2026-09-01' })], '2026-10-06')[0].status).toBe('Quá hạn');
  });
});
async function seedLoans() {
  await saveWallet({ id: 'wallet', name: 'Ví thử', type: 'cash', icon: '💵', openingBalance: 1000000, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: now() });
  await saveTransaction({ type: 'lend', amount: 100000, walletId: 'wallet', date: '2026-01-01', personName: 'Người A' });
  await saveTransaction({ type: 'lend', amount: 200000, walletId: 'wallet', date: '2026-02-01', personName: 'Người A' });
}
describe('aggregate payment accounting', () => {
  it('allocates one group payment oldest-first without changing loan IDs or principal', async () => {
    await seedLoans(); const ids = (await db.debts.toArray()).map(d => d.id).sort();
    await payPersonDebt('lend', ' người a ', 150000, 'wallet', '2026-03-01');
    const group = (await getPersonDebtOverview())[0]; expect(group.remaining).toBe(150000); expect(group.originalAmount).toBe(300000); expect(group.debts.find(d => d.date === '2026-01-01')?.remaining).toBe(0); expect(group.debts.find(d => d.date === '2026-02-01')?.remaining).toBe(150000);
    expect((await db.debts.toArray()).map(d => d.id).sort()).toEqual(ids); expect(await db.debtPayments.count()).toBe(2); expect((await getBalances()).wallet).toBe(850000);
    const payment = (await db.debtPayments.toArray())[0]; await trashTransaction(payment.transactionId); expect((await getPersonDebtOverview())[0].remaining).toBe(150000 + payment.amount);
  });
  it('rejects overpayment and payments against future loans with no partial writes', async () => {
    await seedLoans(); await expect(payPersonDebt('lend', 'Người A', 300001, 'wallet', '2026-03-01')).rejects.toThrow(); await expect(payPersonDebt('lend', 'Người A', 150000, 'wallet', '2026-01-15')).rejects.toThrow(); expect(await db.debtPayments.count()).toBe(0); expect(await db.transactions.count()).toBe(2); expect((await getBalances()).wallet).toBe(700000);
  });
  it('rolls back the entire group payment if one split fails to write', async () => {
    await seedLoans(); const fail = (_key: unknown, row: { amount: number }) => { if (row.amount === 50000) throw new Error('Simulated payment failure'); };
    db.debtPayments.hook('creating').subscribe(fail);
    try { await expect(payPersonDebt('lend', 'Người A', 150000, 'wallet', '2026-03-01')).rejects.toThrow('Simulated payment failure'); } finally { db.debtPayments.hook('creating').unsubscribe(fail); }
    expect(await db.debtPayments.count()).toBe(0); expect(await db.transactions.count()).toBe(2); expect((await getPersonDebtOverview())[0].remaining).toBe(300000); expect((await getBalances()).wallet).toBe(700000);
  });
});

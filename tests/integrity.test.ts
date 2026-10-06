import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { db, FinanceDB, schemaV1, schemaV2, initializeDatabase } from '../src/db';
import { saveWallet, saveTransaction, getBalances, adjustBalance, trashTransaction, restoreTransaction, payDebt, debtRemaining, generateRecurring, permanentDelete, emptyTrash, deleteCategory, netWorthHistory, queryTransactions, aggregate } from '../src/services';
import { createBackup, readBackup, restoreBackup, checksum, validateSnapshot } from '../src/backup';
import { now } from '../src/finance';
import type { Wallet, RecurringTransaction } from '../src/types';

const wallet = (id = 'a'): Wallet => ({ id, name: id, icon: '💵', type: 'cash', currency: 'VND', openingBalance: 1000000, includeInNetWorth: true, archived: false, createdAt: now() });
async function seedWallets() { await saveWallet(wallet()); await saveWallet(wallet('b')); }
describe('atomic ledger operations', () => {
  it('never recreates intentionally deleted categories or resets balances on startup', async () => { await seedWallets(); await db.categories.clear(); await initializeDatabase(); expect(await db.categories.count()).toBe(0); expect((await getBalances()).a).toBe(1000000); });
  it('persists entries and derives balances after database reopen', async () => { await seedWallets(); await saveTransaction({ type: 'expense', amount: 50000, categoryId: 'expense-0', walletId: 'a', date: '2026-10-06', tags: ['work'] }); db.close(); await db.open(); expect((await getBalances()).a).toBe(950000); expect(await db.tags.count()).toBe(1); expect(await db.transactionTags.count()).toBe(1); });
  it('rejects impossible transfers without leaving a half transfer', async () => { await seedWallets(); await expect(saveTransaction({ type: 'transfer', amount: 10000, walletId: 'a', destinationWalletId: 'a', date: '2026-10-06' })).rejects.toThrow(); expect(await db.transactions.count()).toBe(0); expect((await getBalances()).a).toBe(1000000); });
  it('creates an explicit adjustment and restores the prior balance on trash', async () => { await seedWallets(); await adjustBalance('a', 850000, '2026-10-06'); const t = (await db.transactions.toArray())[0]; expect(t.amount).toBe(-150000); expect((await getBalances()).a).toBe(850000); await trashTransaction(t.id); expect((await getBalances()).a).toBe(1000000); await restoreTransaction(t.id); expect((await getBalances()).a).toBe(850000); });
  it('protects opening balance once the wallet has history', async () => { await seedWallets(); await saveTransaction({ type: 'income', amount: 10000, categoryId: 'income-0', walletId: 'a', date: '2026-10-06' }); await expect(saveWallet({ ...wallet(), openingBalance: 5 })).rejects.toThrow(); });
  it('records partial debt repayment and rejects overpayment atomically', async () => {
    await seedWallets(); await saveTransaction({ type: 'borrow', amount: 500000, walletId: 'a', date: '2026-10-01', personName: 'An' }); const debt = (await db.debts.toArray())[0];
    await payDebt(debt.id, 200000, 'b', '2026-10-06'); expect(await debtRemaining(debt.id)).toBe(300000); expect((await getBalances()).b).toBe(800000);
    await expect(payDebt(debt.id, 400000, 'b')).rejects.toThrow(); expect(await db.debtPayments.count()).toBe(1); expect(await db.transactions.count()).toBe(2);
    await expect(trashTransaction(debt.transactionId)).rejects.toThrow();
    const payment = (await db.debtPayments.toArray())[0]; await trashTransaction(payment.transactionId); expect(await debtRemaining(debt.id)).toBe(500000); expect((await getBalances()).b).toBe(1000000);
    await restoreTransaction(payment.transactionId); expect(await debtRemaining(debt.id)).toBe(300000);
  });
  it('collects a loan into the linked wallet and preserves net worth', async () => {
    await seedWallets(); await saveTransaction({ type: 'lend', amount: 500000, walletId: 'a', date: '2026-10-01', personName: 'Bình' }); const d = (await db.debts.toArray())[0]; await payDebt(d.id, 500000, 'b', '2026-10-06');
    expect(await debtRemaining(d.id)).toBe(0); expect((await getBalances()).a).toBe(500000); expect((await getBalances()).b).toBe(1500000); expect((await netWorthHistory('2026-10-01', '2026-10-06')).at(-1)?.balance).toBe(2000000);
  });
  it('cannot restore a payment while the parent debt is in trash', async () => {
    await seedWallets(); await saveTransaction({ type: 'borrow', amount: 5000, walletId: 'a', date: '2026-10-01', personName: 'An' }); const debt = (await db.debts.toArray())[0]; await payDebt(debt.id, 5000, 'a', '2026-10-02'); const p = (await db.debtPayments.toArray())[0]; await trashTransaction(p.transactionId); await trashTransaction(debt.transactionId); await expect(restoreTransaction(p.transactionId)).rejects.toThrow(); await emptyTrash(); expect(await db.debts.count()).toBe(0); expect(await db.debtPayments.count()).toBe(0);
  });
  it('only permanently removes already trashed records', async () => { await seedWallets(); const txId = await saveTransaction({ type: 'expense', amount: 100, walletId: 'a', categoryId: 'expense-0', date: '2026-10-06' }); await expect(permanentDelete(txId)).rejects.toThrow(); expect(await db.transactions.count()).toBe(1); });
  it('merges category references without losing transactions or breaking settings', async () => { await seedWallets(); await saveTransaction({ type: 'expense', amount: 100, walletId: 'a', categoryId: 'expense-0', date: '2026-10-06' }); await expect(deleteCategory('expense-0')).rejects.toThrow(); await deleteCategory('expense-0', 'expense-1'); expect((await db.transactions.toArray())[0].categoryId).toBe('expense-1'); await createBackup(); });
  it('matches report drill-down to transfer fees and the correct fee wallet', async () => { await seedWallets(); await saveTransaction({ type: 'transfer', amount: 10000, walletId: 'a', destinationWalletId: 'b', feeWalletId: 'b', transferFee: 500, date: '2026-10-06' }); await saveTransaction({ type: 'expense', amount: 1000, walletId: 'a', categoryId: 'expense-0', date: '2026-10-06', includeInReports: false }); expect((await queryTransactions({ reportType: 'expense' })).rows).toHaveLength(1); expect((await queryTransactions({ reportType: 'expense', walletId: 'a' })).rows).toHaveLength(0); expect((await aggregate('2026-10-01', '2026-10-31', { walletId: 'a' })).expense).toBe(0); expect((await aggregate('2026-10-01', '2026-10-31', { walletId: 'b' })).expense).toBe(500); });
});
describe('recurring generation', () => {
  const rule: RecurringTransaction = { id: 'r', type: 'expense', amount: 1000, walletId: 'a', categoryId: 'expense-0', note: '', frequency: 'monthly', interval: 1, startDate: '2026-01-31', nextRunDate: '2026-01-31', anchorDay: 31, autoCreate: true, archived: false };
  it('catches up and does not duplicate under concurrent calls or reopen', async () => { await seedWallets(); await db.recurring.add(rule); await Promise.all([generateRecurring('2026-03-31'), generateRecurring('2026-03-31')]); expect(await db.transactions.count()).toBe(3); expect((await db.transactions.orderBy('date').toArray()).map(t => t.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']); db.close(); await db.open(); expect(await generateRecurring('2026-03-31')).toBe(0); });
  it('honors endDate, disabled autoCreate and archived rules', async () => { await seedWallets(); await db.recurring.add({ ...rule, endDate: '2026-02-28' }); await generateRecurring('2026-10-06'); expect(await db.transactions.count()).toBe(2); await db.recurring.put({ ...rule, id: 'manual', autoCreate: false }); await generateRecurring('2026-10-06'); expect(await db.transactions.count()).toBe(2); await generateRecurring('2026-01-31', 'manual', true); expect(await db.transactions.count()).toBe(3); });
  it('rolls back all occurrences and cursor when validation fails', async () => { await db.recurring.add(rule); await expect(generateRecurring('2026-03-31')).rejects.toThrow(); expect(await db.transactions.count()).toBe(0); expect((await db.recurring.get('r'))?.nextRunDate).toBe('2026-01-31'); });
});
describe('backup, restore and schema evolution', () => {
  it('roundtrips a complete backup including tag relations', async () => {
    await seedWallets(); await saveTransaction({ type: 'income', amount: 5000, walletId: 'a', categoryId: 'income-0', date: '2026-10-06', tags: ['work'] }); const backup = await createBackup(); const parsed = await readBackup(JSON.stringify(backup)); await restoreBackup(parsed, 'replace'); expect((await getBalances()).a).toBe(1005000); expect(await db.transactionTags.count()).toBe(1); expect(Object.keys(parsed.data)).toHaveLength(15);
  });
  it('rejects a corrupted backup without deleting current data', async () => { await seedWallets(); const backup = await createBackup(); backup.data.wallets[0].openingBalance = 10; await expect(restoreBackup(backup, 'replace')).rejects.toThrow('Checksum'); expect((await getBalances()).a).toBe(1000000); });
  it('rejects broken references even with a recomputed checksum', async () => { await seedWallets(); await saveTransaction({ type: 'expense', amount: 10, walletId: 'a', categoryId: 'expense-0', date: '2026-10-06' }); const backup = await createBackup(); backup.data.wallets = []; const { checksum: _sum, ...payload } = backup; backup.checksum = await checksum(payload); await expect(restoreBackup(backup, 'replace')).rejects.toThrow('Liên kết'); expect(await db.wallets.count()).toBe(2); });
  it('merges identical IDs idempotently and rejects divergent IDs', async () => { await seedWallets(); const backup = await createBackup(); await restoreBackup(backup, 'merge'); expect(await db.wallets.count()).toBe(2); await db.wallets.update('a', { name: 'changed' }); await expect(restoreBackup(backup, 'merge')).rejects.toThrow('Xung đột'); expect((await db.wallets.get('a'))?.name).toBe('changed'); });
  it('refuses an unsupported schema version', async () => { const backup = await createBackup(); backup.schemaVersion = 99; await expect(readBackup(JSON.stringify(backup))).rejects.toThrow('chưa được hỗ trợ'); });
  it('rolls back all tables if a database write fails halfway through restore', async () => {
    await seedWallets(); const backup = await createBackup(); await db.wallets.update('a', { name: 'Current data to keep' });
    const fail = () => { throw new Error('Simulated disk failure'); }; db.categories.hook('creating').subscribe(fail);
    try { await expect(restoreBackup(backup, 'replace')).rejects.toThrow('Simulated disk failure'); } finally { db.categories.hook('creating').unsubscribe(fail); }
    expect((await db.wallets.get('a'))?.name).toBe('Current data to keep'); expect(await db.categories.count()).toBe(12);
  });
  it('upgrades a verified v2 backup while preserving every record', async () => { await seedWallets(); const backup = await createBackup(); const { checksum: _sum, ...payload } = backup; payload.schemaVersion = 2; const upgraded = await readBackup(JSON.stringify({ ...payload, checksum: await checksum(payload) })); expect(upgraded.schemaVersion).toBe(4); expect(upgraded.data).toEqual(backup.data); await restoreBackup(upgraded, 'replace'); expect(await db.wallets.count()).toBe(2); });
  it('validates accounting linkage in debt backups', async () => { await seedWallets(); await saveTransaction({ type: 'borrow', amount: 5000, walletId: 'a', date: '2026-10-01', personName: 'An' }); const backup = await createBackup(); backup.data.debts[0].originalAmount = 4000; expect(() => validateSnapshot(backup.data)).toThrow('không khớp'); });
  it('migrates v1 through v3 preserving IDs, amount and destination-wallet index', async () => {
    const name = `migration-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(1).stores(schemaV1); await old.open(); await old.table('wallets').add(wallet()); await old.table('transactions').add({ id: 'old-tx', type: 'transfer', amount: 123456, walletId: 'a', destinationWalletId: 'b', date: '2020-01-01', note: 'keep' }); old.close();
    const upgraded = new FinanceDB(name); await upgraded.open(); const tx = await upgraded.transactions.get('old-tx'); expect(tx?.amount).toBe(123456); expect(tx?.note).toBe('keep'); expect(tx?.walletIds).toEqual(['a', 'b']); expect(await upgraded.transactions.where('walletIds').equals('b').count()).toBe(1); expect(await upgraded.transactions.orderBy('[date+time]').count()).toBe(1); expect(tx?.time).toBe('12:00'); upgraded.close(); await Dexie.delete(name);
  });
  it('migrates v2 to v3 and indexes actual time rather than random UUID order', async () => {
    const name = `migration-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(2).stores(schemaV2); await old.open();
    await old.table('transactions').bulkAdd([{ id: 'z', date: '2026-10-06', time: '08:00', amount: 10 }, { id: 'a', date: '2026-10-06', time: '19:00', amount: 20 }]); old.close();
    const upgraded = new FinanceDB(name); await upgraded.open(); const rows = await upgraded.transactions.orderBy('[date+time]').reverse().toArray(); expect(rows.map(t => t.id)).toEqual(['a', 'z']); expect(rows.map(t => t.amount)).toEqual([20, 10]); upgraded.close(); await Dexie.delete(name);
  });
});

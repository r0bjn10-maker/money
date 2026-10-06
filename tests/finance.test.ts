import { describe, it, expect } from 'vitest';
import { calculateExpression, calculateBalances, nextOccurrence, reportAmounts, assertDate, walletEffects } from '../src/finance';
import { makeTransaction } from '../src/services';
import type { Wallet, RecurringTransaction } from '../src/types';

describe('financial primitives', () => {
  const wallets: Wallet[] = ['a', 'b', 'c'].map(id => ({ id, name: id, type: 'cash', icon: '💵', openingBalance: 1000000, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: '2026-01-01T00:00:00.000Z' }));
  const tx = (type: 'income' | 'expense' | 'transfer' | 'adjustment', amount: number) => makeTransaction({ type, amount, walletId: 'a', date: '2026-10-06', categoryId: type === 'income' ? 'income-0' : 'expense-0' });
  it('calculates income, expense, adjustment and ignores trash', () => {
    const deleted = { ...tx('income', 9999999), deletedAt: '2026-10-06T00:00:00.000Z' };
    expect(calculateBalances(wallets, [tx('income', 500000), tx('expense', 70000), tx('adjustment', -150000), deleted]).a).toBe(1280000);
  });
  it('moves principal without income/expense, accounting fee exactly once', () => {
    const transfer = { ...tx('transfer', 350000), destinationWalletId: 'b', transferFee: 5000, feeWalletId: 'c' };
    expect(calculateBalances(wallets, [transfer])).toEqual({ a: 650000, b: 1350000, c: 995000 });
    expect(reportAmounts(transfer)).toEqual({ income: 0, expense: 5000 });
  });
  it('does not classify borrowed or lent principal as income or expense', () => {
    for (const type of ['borrow', 'lend', 'adjustment', 'debt-payment'] as const) expect(reportAmounts(makeTransaction({ type, amount: 500000, walletId: 'a', date: '2026-10-06' }))).toEqual({ income: 0, expense: 0 });
  });
  it('preserves independent wallet changes when fee comes from destination', () => {
    const t = makeTransaction({ type: 'transfer', amount: 10000, walletId: 'a', destinationWalletId: 'b', feeWalletId: 'b', transferFee: 1000, date: '2026-10-06' });
    expect(walletEffects(t).get('b')).toBe(9000);
  });
  it.each([['120000 + 35000', 155000], ['1000 * (2 + 3)', 5000], ['500 - 100 / 2', 450], ['-150000', -150000], ['+100', 100]])('evaluates %s safely', (input, value) => expect(calculateExpression(input)).toBe(value));
  it.each(['alert(1)', '1/0', '1.5', '1+', '1..2', '9007199254740992', '1(2)'])('rejects unsafe or invalid expression %s', input => expect(() => calculateExpression(input)).toThrow());
  it('rejects invalid calendar dates rather than normalizing them', () => { expect(() => assertDate('2026-02-30')).toThrow(); expect(() => assertDate('2026-13-01')).toThrow(); assertDate('2024-02-29'); });
  const rule: RecurringTransaction = { id: 'r', type: 'expense', amount: 100, categoryId: 'expense-0', walletId: 'a', note: '', frequency: 'monthly', interval: 1, startDate: '2026-01-31', nextRunDate: '2026-01-31', autoCreate: true, archived: false, anchorDay: 31 };
  it('restores day 31 after a short month', () => { expect(nextOccurrence(rule, '2026-01-31')).toBe('2026-02-28'); expect(nextOccurrence(rule, '2026-02-28')).toBe('2026-03-31'); });
  it('supports yearly leap day and custom intervals', () => { expect(nextOccurrence({ ...rule, frequency: 'yearly', anchorDay: 29 }, '2024-02-29')).toBe('2025-02-28'); expect(nextOccurrence({ ...rule, frequency: 'custom', interval: 10 }, '2026-10-01')).toBe('2026-10-11'); });
});

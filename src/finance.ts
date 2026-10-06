import { addDays, addMonths, addYears, format, isValid, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import type { Transaction, Wallet, RecurringTransaction } from './types';

export const today = () => format(new Date(), 'yyyy-MM-dd');
export const currentMonth = () => format(new Date(), 'yyyy-MM');
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function assertMoney(value: number, signed = false) {
  if (!Number.isSafeInteger(value) || (!signed && value <= 0)) throw new Error('Số tiền phải là số nguyên VND hợp lệ và lớn hơn 0.');
}
export function assertDate(date: string) {
  const parsed = parseISO(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== date) throw new Error('Ngày không hợp lệ.');
}
export function money(value: number, locale = 'vi-VN', currency = 'VND') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
export function calculateExpression(input: string): number {
  const clean = input.replace(/\s/g, '');
  if (!/^[\d+*/().\-]+$/.test(clean)) throw new Error('Chỉ nhập số và các phép tính + − × ÷.');
  const tokens = clean.match(/\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
  if (tokens.join('') !== clean) throw new Error('Phép tính không hợp lệ.');
  let pos = 0;
  function factor(): number {
    const t = tokens[pos++];
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); if (tokens[pos++] !== ')') throw new Error('Thiếu dấu đóng ngoặc.'); return v; }
    if (!t || !/^\d/.test(t)) throw new Error('Phép tính chưa hoàn chỉnh.');
    return Number(t);
  }
  function term(): number { let v = factor(); while (tokens[pos] === '*' || tokens[pos] === '/') { const op = tokens[pos++]; const n = factor(); v = op === '*' ? v * n : v / n; } return v; }
  function expr(): number { let v = term(); while (tokens[pos] === '+' || tokens[pos] === '-') { const op = tokens[pos++]; const n = term(); v = op === '+' ? v + n : v - n; } return v; }
  const value = expr();
  if (pos !== tokens.length || !Number.isSafeInteger(value)) throw new Error('Kết quả phải là số nguyên VND hợp lệ.');
  return value;
}
export function walletEffects(tx: Transaction): Map<string, number> {
  const effects = new Map<string, number>();
  if (tx.deletedAt) return effects;
  const add = (walletId: string | undefined, amount: number) => { if (walletId) effects.set(walletId, (effects.get(walletId) ?? 0) + amount); };
  switch (tx.type) {
    case 'expense': case 'lend': add(tx.walletId, -tx.amount); break;
    case 'income': case 'borrow': case 'adjustment': add(tx.walletId, tx.amount); break;
    case 'transfer': add(tx.walletId, -tx.amount); add(tx.destinationWalletId, tx.amount); add(tx.feeWalletId ?? tx.walletId, -tx.transferFee); break;
    case 'debt-payment': add(tx.walletId, tx.paymentDirection === 'in' ? tx.amount : -tx.amount); break;
  }
  return effects;
}
export function calculateBalances(wallets: Wallet[], transactions: Transaction[]) {
  const result: Record<string, number> = Object.fromEntries(wallets.map(w => [w.id, w.openingBalance]));
  for (const tx of transactions) for (const [walletId, amount] of walletEffects(tx)) result[walletId] = (result[walletId] ?? 0) + amount;
  return result;
}
export function reportAmounts(tx: Transaction) {
  if (tx.deletedAt || !tx.includeInReports) return { income: 0, expense: 0 };
  return { income: tx.type === 'income' ? tx.amount : 0, expense: tx.type === 'expense' ? tx.amount : tx.type === 'transfer' ? tx.transferFee : 0 };
}
export function monthRange(month: string) { const date = parseISO(`${month}-01`); return [format(startOfMonth(date), 'yyyy-MM-dd'), format(endOfMonth(date), 'yyyy-MM-dd')] as const; }
export function nextOccurrence(rule: RecurringTransaction, date: string): string {
  const d = parseISO(date);
  if (rule.frequency === 'daily') return format(addDays(d, 1), 'yyyy-MM-dd');
  if (rule.frequency === 'weekly') return format(addDays(d, 7), 'yyyy-MM-dd');
  if (rule.frequency === 'custom') return format(addDays(d, rule.interval), 'yyyy-MM-dd');
  const target = rule.frequency === 'monthly' ? addMonths(d, 1) : addYears(d, 1);
  target.setDate(Math.min(rule.anchorDay, endOfMonth(target).getDate()));
  return format(target, 'yyyy-MM-dd');
}

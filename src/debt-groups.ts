import type { Debt } from './types';
import { today } from './finance';

export type DebtWithBalance = Debt & { remaining: number; status: string };
export interface PersonDebtGroup {
  key: string;
  kind: Debt['kind'];
  personName: string;
  debts: DebtWithBalance[];
  originalAmount: number;
  remaining: number;
  date: string;
  dueDate?: string;
  status: string;
}
export const normalizePersonName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
export const personDebtKey = (kind: Debt['kind'], name: string) => JSON.stringify([kind, normalizePersonName(name)]);

export function groupDebtsByPerson(debts: DebtWithBalance[], asOf = today()): PersonDebtGroup[] {
  const groups = new Map<string, PersonDebtGroup>();
  for (const debt of debts) {
    const key = personDebtKey(debt.kind, debt.personName);
    const group = groups.get(key) ?? { key, kind: debt.kind, personName: debt.personName.trim().replace(/\s+/g, ' '), debts: [], originalAmount: 0, remaining: 0, date: debt.date, status: '' };
    group.debts.push(debt);
    group.originalAmount += debt.originalAmount;
    group.remaining += debt.remaining;
    if (debt.date < group.date) group.date = debt.date;
    if (debt.remaining > 0 && debt.dueDate && (!group.dueDate || debt.dueDate < group.dueDate)) group.dueDate = debt.dueDate;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.debts.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    group.status = group.remaining === 0 ? group.kind === 'borrow' ? 'Đã trả' : 'Đã thu' : group.dueDate && group.dueDate < asOf ? 'Quá hạn' : 'Đang mở';
  }
  return [...groups.values()].sort((a, b) => Number(b.remaining > 0) - Number(a.remaining > 0) || a.personName.localeCompare(b.personName, 'vi'));
}

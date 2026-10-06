import { z } from 'zod';
import { db, defaultSettings } from './db';
import { APP_VERSION, DB_VERSION } from './types';
import { assertDate, id, now } from './finance';

const key = z.string().min(1).max(200);
const text = z.string().max(100000);
const cash = z.number().int().safe();
const positive = cash.positive();
const date = z.string().refine(s => { try { assertDate(s); return true; } catch { return false; } }, 'Ngày không hợp lệ');
const stamp = z.string().datetime({ offset: true });
const optionalKey = key.optional();
export const dataSchemas = {
  wallets: z.object({ id: key, name: text.min(1), type: z.enum(['cash', 'bank', 'ewallet', 'savings', 'investment', 'other']), icon: text, openingBalance: cash, currency: z.string().refine((c): boolean => c === 'VND', 'Chỉ hỗ trợ VND'), includeInNetWorth: z.boolean(), archived: z.boolean(), createdAt: stamp, balanceVerified: z.boolean().optional() }),
  categories: z.object({ id: key, name: text.min(1), type: z.enum(['expense', 'income']), parentId: optionalKey, icon: text, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), sortOrder: cash, archived: z.boolean() }),
  transactions: z.object({ id: key, type: z.enum(['expense', 'income', 'transfer', 'borrow', 'lend', 'adjustment', 'debt-payment']), amount: cash, walletId: key, destinationWalletId: optionalKey, transferFee: cash.nonnegative(), feeWalletId: optionalKey, categoryId: optionalKey, date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), note: text, tags: z.array(key), eventId: optionalKey, includeInReports: z.boolean(), createdAt: stamp, updatedAt: stamp, deletedAt: stamp.optional(), walletIds: z.array(key), debtId: optionalKey, paymentDirection: z.enum(['in', 'out']).optional(), recurringKey: optionalKey, source: text.optional(), sourceId: text.optional(), sourceFile: text.optional(), sourceSheet: text.optional(), sourceRow: cash.nonnegative().optional(), importBatchId: optionalKey, fingerprint: text.optional() }).refine(t => t.type === 'adjustment' || t.amount > 0, 'Số tiền phải dương'),
  budgets: z.object({ id: key, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), categoryId: optionalKey, amount: positive, name: text.min(1) }),
  debts: z.object({ id: key, kind: z.enum(['borrow', 'lend']), personName: text.min(1), originalAmount: positive, date, dueDate: date.optional(), note: text, walletId: key, transactionId: key }),
  debtPayments: z.object({ id: key, debtId: key, transactionId: key, amount: positive, date }),
  recurring: z.object({ id: key, type: z.enum(['income', 'expense']), amount: positive, categoryId: key, walletId: key, note: text, frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']), interval: positive.max(36500), startDate: date, endDate: date.optional(), nextRunDate: date, autoCreate: z.boolean(), archived: z.boolean(), anchorDay: z.number().int().min(1).max(31) }),
  events: z.object({ id: key, name: text.min(1), startDate: date, endDate: date, expectedExpense: cash.nonnegative(), expectedIncome: cash.nonnegative(), note: text }),
  tags: z.object({ id: key, name: key }),
  transactionTags: z.object({ id: key, transactionId: key, tagId: key }),
  importBatches: z.object({ id: key, source: text, sourceFile: text, importedAt: stamp, count: cash.nonnegative(), income: cash.nonnegative(), expense: cash.nonnegative(), sourceRowCount: cash.nonnegative().optional(), reconciliation: text.optional() }),
  hedaSourceRows: z.object({ id: key, batchId: key, fileName: text, fileHash: key, sheet: text, row: positive, ordinal: positive, periodStart: date, periodEnd: date, walletName: text, originalType: text, category: text, subcategory: text, note: text, amount: cash, balanceAfter: cash, date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), originalTime: text, transactionIds: z.array(key), purgedTransactionIds: z.array(key).optional() }),
  importIssues: z.object({ id: key, batchId: key, row: cash.nonnegative(), message: text, raw: text }),
  settings: z.object({ id: z.literal('app'), currency: z.literal('VND'), firstDayOfWeek: z.union([z.literal(0), z.literal(1)]), dateFormat: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd']), numberFormat: z.enum(['vi-VN', 'en-US']), theme: z.enum(['light', 'dark', 'system']), defaultWalletId: optionalKey, lastCategoryId: optionalKey, lastBackup: stamp.optional() }),
  backupMetadata: z.object({ id: key, exportedAt: stamp, checksum: text }),
};
export type DataSnapshot = { [K in keyof typeof dataSchemas]: z.infer<(typeof dataSchemas)[K]>[] };
export const tableNames = Object.keys(dataSchemas) as (keyof DataSnapshot)[];
const snapshotSchema = z.object(Object.fromEntries(tableNames.map(k => [k, z.array(dataSchemas[k])])));
export interface Backup { schemaVersion: number; appVersion: string; exportedAt: string; data: DataSnapshot; checksum: string }
export async function checksum(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function snapshot(): Promise<DataSnapshot> {
  return db.transaction('r', db.tables, async () => Object.fromEntries(await Promise.all(tableNames.map(async name => [name, await db.table(name).toArray()])))) as Promise<DataSnapshot>;
}
export function validateSnapshot(raw: unknown): DataSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 12).map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Dữ liệu không hợp lệ:\n${errors}`);
  }
  const data = parsed.data as DataSnapshot;
  for (const wallet of data.wallets) if (wallet.balanceVerified === false && wallet.includeInNetWorth) throw new Error('Ví chưa xác minh số dư không được tính vào tổng tài sản.');
  const transactionMap = new Map(data.transactions.map(t => [t.id, t]));
  const categoryMap = new Map(data.categories.map(c => [c.id, c]));
  const paymentsByDebt = new Map<string, DataSnapshot['debtPayments']>();
  for (const payment of data.debtPayments) { const group = paymentsByDebt.get(payment.debtId) ?? []; group.push(payment); paymentsByDebt.set(payment.debtId, group); }
  const indexes = Object.fromEntries(tableNames.map(k => [k, new Map(data[k].map(row => [row.id, row]))]));
  for (const name of tableNames) if (indexes[name].size !== data[name].length) throw new Error(`ID trùng trong ${name}.`);
  if (data.settings.length !== 1) throw new Error('Backup phải có đúng một bản cài đặt.');
  const reference = (table: keyof DataSnapshot, value?: string) => { if (value && !indexes[table].has(value)) throw new Error(`Liên kết bị hỏng: ${table}/${value}.`); };
  const recurringKeys = new Set<string>();
  for (const t of data.transactions) {
    reference('wallets', t.walletId); reference('wallets', t.destinationWalletId); reference('wallets', t.feeWalletId); reference('categories', t.categoryId); reference('events', t.eventId); reference('debts', t.debtId); reference('importBatches', t.importBatchId);
    const actual = [...new Set([t.walletId, t.destinationWalletId, t.type === 'transfer' ? (t.feeWalletId ?? t.walletId) : undefined].filter(Boolean))].sort();
    if (JSON.stringify([...t.walletIds].sort()) !== JSON.stringify(actual)) throw new Error(`Chỉ mục ví sai: ${t.id}.`);
    if ((t.type === 'expense' || t.type === 'income') && categoryMap.get(t.categoryId ?? '')?.type !== t.type) throw new Error(`Danh mục sai loại: ${t.id}.`);
    if (t.type === 'transfer' && (!t.destinationWalletId || t.walletId === t.destinationWalletId)) throw new Error(`Chuyển khoản không hợp lệ: ${t.id}.`);
    if (t.type !== 'transfer' && (t.destinationWalletId || t.transferFee)) throw new Error(`Trường chuyển khoản sai loại: ${t.id}.`);
    if (t.type === 'debt-payment' && !t.paymentDirection) throw new Error(`Thiếu hướng thanh toán: ${t.id}.`);
    if (t.recurringKey) { if (recurringKeys.has(t.recurringKey)) throw new Error('Lịch định kỳ bị trùng.'); recurringKeys.add(t.recurringKey); }
    if ((t.type === 'borrow' || t.type === 'lend' || t.type === 'debt-payment') && !t.debtId) throw new Error(`Giao dịch nợ thiếu liên kết: ${t.id}.`);
  }
  for (const c of data.categories) if (c.parentId) { reference('categories', c.parentId); const parent = categoryMap.get(c.parentId)!; if (parent.id === c.id || parent.parentId || parent.type !== c.type) throw new Error('Cấu trúc danh mục cha/con không hợp lệ.'); }
  for (const b of data.budgets) { reference('categories', b.categoryId); if (b.categoryId && categoryMap.get(b.categoryId)?.type !== 'expense') throw new Error('Ngân sách phải dùng danh mục chi tiêu.'); }
  for (const r of data.recurring) { reference('wallets', r.walletId); reference('categories', r.categoryId); if (categoryMap.get(r.categoryId)?.type !== r.type || r.nextRunDate < r.startDate || (r.endDate && r.endDate < r.startDate)) throw new Error('Lịch định kỳ không hợp lệ.'); }
  for (const e of data.events) if (e.endDate < e.startDate) throw new Error('Ngày kết thúc sự kiện trước ngày bắt đầu.');
  const paymentTransactions = new Set<string>();
  for (const d of data.debts) {
    reference('wallets', d.walletId); reference('transactions', d.transactionId);
    const tx = transactionMap.get(d.transactionId)!;
    if (tx.debtId !== d.id || tx.type !== d.kind || tx.amount !== d.originalAmount || tx.walletId !== d.walletId || tx.date !== d.date) throw new Error('Bút toán gốc của khoản nợ không khớp.');
    let paid = 0;
    for (const p of paymentsByDebt.get(d.id) ?? []) {
      reference('transactions', p.transactionId); const t = transactionMap.get(p.transactionId)!;
      if (paymentTransactions.has(p.transactionId) || t.type !== 'debt-payment' || t.debtId !== d.id || t.amount !== p.amount || t.date !== p.date || t.paymentDirection !== (d.kind === 'lend' ? 'in' : 'out') || t.date < d.date || (tx.deletedAt && !t.deletedAt)) throw new Error('Bút toán trả nợ không khớp.');
      paymentTransactions.add(p.transactionId); if (!t.deletedAt) paid += p.amount;
    }
    if (paid > d.originalAmount) throw new Error('Thanh toán vượt số nợ gốc.');
  }
  for (const p of data.debtPayments) { reference('debts', p.debtId); reference('transactions', p.transactionId); }
  for (const t of data.transactions.filter(t => t.type === 'debt-payment')) if (!paymentTransactions.has(t.id)) throw new Error('Giao dịch trả nợ thiếu lịch sử thanh toán.');
  const tagNames = new Set(data.tags.map(t => t.name)); if (tagNames.size !== data.tags.length) throw new Error('Tên tag bị trùng.');
  const tagsById = new Map(data.tags.map(t => [t.id, t]));
  const tagsByName = new Map(data.tags.map(t => [t.name, t]));
  const tagPairs = new Set<string>();
  for (const link of data.transactionTags) {
    reference('transactions', link.transactionId); reference('tags', link.tagId);
    const pair = `${link.transactionId}:${link.tagId}`;
    if (tagPairs.has(pair) || !transactionMap.get(link.transactionId)!.tags.includes(tagsById.get(link.tagId)!.name)) throw new Error('Quan hệ tag và giao dịch không khớp.');
    tagPairs.add(pair);
  }
  for (const tx of data.transactions) for (const name of tx.tags) {
    const tag = tagsByName.get(name);
    if (!tag || !tagPairs.has(`${tx.id}:${tag.id}`)) throw new Error(`Giao dịch thiếu liên kết tag: ${tx.id}/${name}.`);
  }
  for (const issue of data.importIssues) reference('importBatches', issue.batchId);
  for (const row of data.hedaSourceRows) {
    reference('importBatches', row.batchId);
    if (!row.transactionIds.length && !row.purgedTransactionIds?.length) throw new Error('Dòng nguồn thiếu giao dịch tương ứng hoặc dấu vết đã xóa.');
    if (new Set(row.transactionIds).size !== row.transactionIds.length) throw new Error('Liên kết dòng nguồn bị trùng.');
    for (const transactionId of row.transactionIds) reference('transactions', transactionId);
  }
  reference('wallets', data.settings[0].defaultWalletId); reference('categories', data.settings[0].lastCategoryId);
  return data;
}
export async function createBackup(): Promise<Backup> {
  const data = validateSnapshot(await snapshot());
  const exportedAt = now();
  const payload = { schemaVersion: DB_VERSION, appVersion: APP_VERSION, exportedAt, data };
  return { ...payload, checksum: await checksum(payload) };
}
export async function readBackup(text: string): Promise<Backup> {
  let raw: Backup;
  try { raw = JSON.parse(text); } catch { throw new Error('File không phải JSON hợp lệ.'); }
  if (![2, 3, DB_VERSION].includes(raw.schemaVersion)) throw new Error(`Backup schema v${raw.schemaVersion} chưa được hỗ trợ; ứng dụng dùng v${DB_VERSION}. Không thay đổi dữ liệu hiện tại.`);
  const { checksum: expected, ...payload } = raw;
  if (!expected || await checksum(payload) !== expected) throw new Error('Checksum không khớp. File có thể đã bị sửa hoặc bị hỏng.');
  if (!raw.appVersion || !raw.exportedAt) throw new Error('Thiếu metadata của backup.');
  if (raw.schemaVersion < DB_VERSION) {
    // Prior versions had no source-row table. Adding it never rewrites financial records.
    const upgraded = { ...payload, schemaVersion: DB_VERSION, data: validateSnapshot({ ...raw.data, hedaSourceRows: [] }) };
    return { ...upgraded, checksum: await checksum(upgraded) };
  }
  validateSnapshot(raw.data);
  return raw;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function mergeSnapshots(current: DataSnapshot, incoming: DataSnapshot) {
  const merged = structuredClone(current);
  for (const name of tableNames) {
    if (name === 'settings') continue;
    const rows = new Map(current[name].map(x => [x.id, x]));
    for (const row of incoming[name]) {
      const existing = rows.get(row.id);
      if (existing && canonical(existing) !== canonical(row)) throw new Error(`Xung đột ${name}/${row.id}. Không gộp dữ liệu khác nhau có cùng ID. Hãy chọn thay thế nếu muốn dùng bản backup.`);
      if (!existing) (merged[name] as { id: string }[]).push(row);
    }
  }
  return validateSnapshot(merged);
}
export async function restoreBackup(backup: Backup, mode: 'replace' | 'merge') {
  // Revalidate checksum immediately before writing; preview alone does not authorize invalid data.
  const validated = await readBackup(JSON.stringify(backup));
  await db.transaction('rw', db.tables, async () => {
    const data = mode === 'merge' ? mergeSnapshots(await snapshot(), validated.data) : validated.data;
    for (const name of tableNames) { await db.table(name).clear(); await db.table(name).bulkAdd(data[name]); }
  });
}
export function downloadFile(data: BlobPart, filename: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportBackup() {
  const backup = await createBackup();
  downloadFile(JSON.stringify(backup, null, 2), `personal-finance-backup-${backup.exportedAt.slice(0, 10)}.json`);
  await db.transaction('rw', db.settings, db.backupMetadata, async () => {
    await db.settings.update('app', { lastBackup: backup.exportedAt });
    await db.backupMetadata.add({ id: id(), exportedAt: backup.exportedAt, checksum: backup.checksum });
  });
  return backup;
}
export async function resetAllData(confirmation: string) {
  if (confirmation !== 'XÓA TẤT CẢ') throw new Error('Nhập chính xác XÓA TẤT CẢ để xác nhận.');
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.settings.add(defaultSettings);
  });
}

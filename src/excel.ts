import * as XLSX from 'xlsx';
import { db } from './db';
import { snapshot, downloadFile, validateSnapshot, type DataSnapshot } from './backup';
import { id, now, assertDate, assertMoney, reportAmounts, walletEffects } from './finance';
import { makeTransaction } from './services';
import { DB_VERSION, type Category, type Transaction, type Wallet } from './types';

const sheetNames: Record<keyof DataSnapshot, string> = { transactions: 'Transactions', wallets: 'Wallets', categories: 'Categories', budgets: 'Budgets', debts: 'Debts', debtPayments: 'DebtPayments', recurring: 'Recurring', events: 'Events', tags: 'Tags', transactionTags: 'TransactionTags', importBatches: 'ImportBatches', importIssues: 'ImportIssues', settings: 'Settings', backupMetadata: 'BackupMetadata', hedaSourceRows: 'HeDaSourceRows' };
export async function exportExcel() {
  const data = await snapshot(); const workbook = XLSX.utils.book_new();
  const walletNames = new Map(data.wallets.map(x => [x.id, x.name])); const categoryNames = new Map(data.categories.map(x => [x.id, x.name])); const eventNames = new Map(data.events.map(x => [x.id, x.name]));
  for (const table of Object.keys(sheetNames) as (keyof DataSnapshot)[]) {
    const rows = data[table].map(row => {
      const raw = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v]));
      if (table === 'transactions') {
        const tx = row as Transaction;
        return { 'Date': tx.date, 'Type': tx.type, 'Amount (VND)': tx.amount, 'Wallet Name': walletNames.get(tx.walletId), 'Destination Wallet': walletNames.get(tx.destinationWalletId ?? ''), 'Category Name': categoryNames.get(tx.categoryId ?? ''), 'Event Name': eventNames.get(tx.eventId ?? ''), 'Note': tx.note, ...raw };
      }
      return raw;
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = Array.from({ length: Math.max(1, Object.keys(rows[0] ?? {}).length) }, () => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetNames[table]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ schemaVersion: DB_VERSION, app: 'Moc', exportedAt: now(), currency: 'VND' }]), 'Metadata');
  downloadFile(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }), `moc-data-${now().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
export interface InspectedSheet { name: string; headers: string[]; rows: Record<string, unknown>[]; sample: Record<string, unknown>[]; types: Record<string, string[]> }
export function inspectWorkbook(buffer: ArrayBuffer): InspectedSheet[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
    const headers = (matrix[0] ?? []).map(String);
    if (new Set(headers).size !== headers.length) throw new Error(`Sheet ${name} có tiêu đề trùng. Cần xử lý trước khi import.`);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', blankrows: false });
    return { name, headers, rows, sample: rows.slice(0, 50), types: Object.fromEntries(headers.map(h => [h, [...new Set(rows.slice(0, 200).map(r => typeof r[h]))]])) };
  });
}
export interface ImportMapping { date: string; amount: string; type: string; wallet: string; category: string; note: string; time?: string; sourceId?: string; destination?: string; fee?: string; dateFormat: 'yyyy-MM-dd' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'excel'; numberFormat: 'plain' | 'vi-VN' | 'en-US'; currency: 'VND' }
export function parseImportNumber(raw: unknown, numberFormat: ImportMapping['numberFormat']) {
  if (typeof raw === 'number') { assertMoney(raw, true); return raw; }
  let value = String(raw ?? '').trim().replace(/\s|₫|VND/gi, '');
  if (numberFormat === 'vi-VN') { if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,0+)?$/.test(value)) throw new Error('Số không đúng định dạng Việt Nam.'); value = value.replace(/\./g, '').replace(/,0+$/, ''); }
  else if (numberFormat === 'en-US') { if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(value)) throw new Error('Số không đúng định dạng Anh/Mỹ.'); value = value.replace(/,/g, '').replace(/\.0+$/, ''); }
  if (!/^-?\d+$/.test(value)) throw new Error('Thiếu số tiền hoặc số bị sai định dạng.');
  const result = Number(value); assertMoney(result, true); return result;
}
export function parseImportDate(raw: unknown, dateFormat: ImportMapping['dateFormat']) {
  let value: string;
  if (dateFormat === 'excel') {
    if (typeof raw !== 'number') throw new Error('Ngày phải là serial Excel.');
    const d = XLSX.SSF.parse_date_code(raw); if (!d) throw new Error('Ngày Excel không hợp lệ.');
    value = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  } else if (dateFormat === 'yyyy-MM-dd') value = String(raw).trim();
  else {
    const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw).trim()); if (!parts) throw new Error('Ngày không đúng định dạng đã chọn.');
    const [, a, b, year] = parts; value = `${year}-${(dateFormat === 'dd/MM/yyyy' ? b : a).padStart(2, '0')}-${(dateFormat === 'dd/MM/yyyy' ? a : b).padStart(2, '0')}`;
  }
  assertDate(value); return value;
}
export function fingerprint(tx: Pick<Transaction, 'date' | 'time' | 'type' | 'amount' | 'walletId' | 'categoryId' | 'note' | 'destinationWalletId' | 'transferFee'>, sourceId?: string, occurrence = 1) {
  return JSON.stringify(sourceId ? ['generic', 'sourceId', sourceId] : ['generic', tx.date, tx.time, tx.type, tx.amount, tx.walletId, tx.categoryId ?? '', tx.destinationWalletId ?? '', tx.transferFee, tx.note.trim(), occurrence]);
}
export interface ImportPreview { fileName: string; sheetName: string; batchId: string; transactions: Transaction[]; wallets: Wallet[]; categories: Category[]; issues: { row: number; message: string; raw: string }[]; duplicates: number; income: number; expense: number; start?: string; end?: string }
export async function prepareGenericImport(sheet: InspectedSheet, mapping: ImportMapping, fileName: string): Promise<ImportPreview> {
  for (const field of [mapping.date, mapping.amount, mapping.type, mapping.wallet, mapping.category]) if (!field || !sheet.headers.includes(field)) throw new Error('Chọn đầy đủ cột ngày, số tiền, loại, ví và danh mục.');
  const existingWallets = await db.wallets.toArray(), existingCategories = await db.categories.toArray();
  const wallets: Wallet[] = [], categories: Category[] = [], transactions: Transaction[] = [], issues: ImportPreview['issues'] = [];
  const seen = new Set<string>(); await db.transactions.each(t => { if (t.fingerprint) seen.add(t.fingerprint); });
  const occurrences = new Map<string, number>();
  const batchId = id(); let duplicates = 0, income = 0, expense = 0;
  const wallet = (name: string) => { if (!name) throw new Error('Thiếu tên ví.'); let w = [...existingWallets, ...wallets].find(w => w.name === name); if (!w) { w = { id: id(), name, type: 'other', icon: '👛', openingBalance: 0, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: now() }; wallets.push(w); } return w; };
  const category = (name: string, type: 'income' | 'expense') => { if (!name) throw new Error('Thiếu danh mục.'); let c = [...existingCategories, ...categories].find(c => c.name === name && c.type === type); if (!c) { c = { id: id(), name, type, icon: '✨', color: '#86a898', sortOrder: existingCategories.length + categories.length, archived: false }; categories.push(c); } return c; };
  for (let index = 0; index < sheet.rows.length; index++) {
    const row = sheet.rows[index];
    try {
      if (row.deletedAt) throw new Error('Bản ghi trong thùng rác. Dùng backup JSON để khôi phục cả trạng thái xóa.');
      const currency = row.currency ?? row.Currency ?? row['Tiền tệ'];
      if (currency && String(currency).trim().toUpperCase() !== 'VND') throw new Error(`Tiền tệ không khớp VND: ${currency}.`);
      const typeRaw = String(row[mapping.type]).trim().toLowerCase();
      const types: Record<string, 'income' | 'expense' | 'transfer' | 'adjustment'> = { income: 'income', expense: 'expense', transfer: 'transfer', adjustment: 'adjustment', 'thu nhập': 'income', 'chi tiêu': 'expense', 'chuyển khoản': 'transfer', 'điều chỉnh số dư': 'adjustment' };
      const type = types[typeRaw]; if (!type) throw new Error(`Loại giao dịch chưa được hỗ trợ: ${typeRaw}. Khoản nợ cần adapter có bút toán đầy đủ.`);
      const amount = parseImportNumber(row[mapping.amount], mapping.numberFormat); assertMoney(amount, type === 'adjustment');
      const date = parseImportDate(row[mapping.date], mapping.dateFormat);
      const w = wallet(String(row[mapping.wallet] ?? '').trim());
      const c = type === 'income' || type === 'expense' ? category(String(row[mapping.category] ?? '').trim(), type) : undefined;
      let destination: Wallet | undefined;
      if (type === 'transfer') { if (!mapping.destination) throw new Error('Chuyển khoản thiếu cột ví nhận.'); destination = wallet(String(row[mapping.destination] ?? '').trim()); if (destination.id === w.id) throw new Error('Ví nhận và ví gửi trùng nhau.'); }
      const fee = mapping.fee ? parseImportNumber(row[mapping.fee] || 0, mapping.numberFormat) : 0; if (fee < 0) throw new Error('Phí chuyển khoản không thể âm.');
      const time = mapping.time ? String(row[mapping.time] || '12:00').trim() : '12:00'; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Giờ phải có dạng HH:mm.');
      const sourceId = mapping.sourceId ? String(row[mapping.sourceId] ?? '').trim() || undefined : undefined;
      const sourceRow = typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : index + 2;
      const tx = makeTransaction({ type, amount, walletId: w.id, categoryId: c?.id, destinationWalletId: destination?.id, transferFee: type === 'transfer' ? fee : 0, date, time, note: mapping.note ? String(row[mapping.note] ?? '') : '', source: 'generic', sourceId, sourceFile: fileName, sourceSheet: sheet.name, sourceRow, importBatchId: batchId });
      // Natural keys use readable source names so fingerprints remain stable across independent previews.
      const natural = { ...tx, walletId: w.name, categoryId: c?.name, destinationWalletId: destination?.name };
      const naturalKey = fingerprint(natural); const occurrence = (occurrences.get(naturalKey) ?? 0) + 1; occurrences.set(naturalKey, occurrence);
      tx.fingerprint = fingerprint(natural, sourceId, occurrence);
      if (seen.has(tx.fingerprint)) { duplicates++; continue; } seen.add(tx.fingerprint);
      transactions.push(tx); const totals = reportAmounts(tx); income += totals.income; expense += totals.expense;
    } catch (e) { issues.push({ row: typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : index + 2, message: e instanceof Error ? e.message : 'Dữ liệu không hợp lệ', raw: JSON.stringify(row) }); }
  }
  const usedWallets = new Set(transactions.flatMap(t => t.walletIds)); const usedCategories = new Set(transactions.map(t => t.categoryId));
  const dates = transactions.map(t => t.date).sort();
  return { fileName, sheetName: sheet.name, batchId, transactions, wallets: wallets.filter(w => usedWallets.has(w.id)), categories: categories.filter(c => usedCategories.has(c.id)), issues, duplicates, income, expense, start: dates[0], end: dates.at(-1) };
}
export async function commitGenericImport(preview: ImportPreview) {
  if (preview.issues.length) throw new Error('Còn dòng cần kiểm tra. Sửa file và xem lại trước khi nhập để không bỏ mất dữ liệu.');
  if (!preview.transactions.length) throw new Error('Không có giao dịch mới để nhập.');
  await db.transaction('rw', db.tables, async () => {
    for (const tx of preview.transactions) if (tx.fingerprint && await db.transactions.where('fingerprint').equals(tx.fingerprint).count()) throw new Error('Dữ liệu đã thay đổi sau preview. Xem lại để chống trùng.');
    const current = await snapshot();
    const candidate: DataSnapshot = { ...current, wallets: [...current.wallets, ...preview.wallets], categories: [...current.categories, ...preview.categories], transactions: [...current.transactions, ...preview.transactions], importBatches: [...current.importBatches, { id: preview.batchId, source: 'generic', sourceFile: preview.fileName, importedAt: now(), count: preview.transactions.length, income: preview.income, expense: preview.expense }] };
    validateSnapshot(candidate);
    await db.wallets.bulkAdd(preview.wallets); await db.categories.bulkAdd(preview.categories); await db.transactions.bulkAdd(preview.transactions); await db.importBatches.add(candidate.importBatches.at(-1)!);
    let income = 0, expense = 0, count = 0;
    const expectedEffects = new Map<string, number>(), actualEffects = new Map<string, number>();
    for (const t of preview.transactions) for (const [w, delta] of walletEffects(t)) expectedEffects.set(w, (expectedEffects.get(w) ?? 0) + delta);
    await db.transactions.filter(t => t.importBatchId === preview.batchId).each(t => { count++; const a = reportAmounts(t); income += a.income; expense += a.expense; for (const [w, delta] of walletEffects(t)) actualEffects.set(w, (actualEffects.get(w) ?? 0) + delta); });
    if (count !== preview.transactions.length || income !== preview.income || expense !== preview.expense || [...expectedEffects].some(([w, a]) => a !== actualEffects.get(w))) throw new Error('Đối chiếu thất bại; toàn bộ batch đã được rollback.');
  });
  return { count: preview.transactions.length, income: preview.income, expense: preview.expense, walletChangesVerified: true };
}


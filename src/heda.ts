import * as XLSX from 'xlsx';
import { endOfMonth, format, parseISO } from 'date-fns';
import { db } from './db';
import { snapshot, validateSnapshot, checksum, type DataSnapshot } from './backup';
import { assertDate, assertMoney, now, walletEffects, reportAmounts } from './finance';
import { makeTransaction } from './services';
import type { Category, Debt, DebtPayment, HeDaSourceRow, Transaction, Wallet, WalletType } from './types';

const DETAIL_HEADERS = ['Stt', 'Loại giao dịch', 'Danh mục', 'Danh mục con', 'Ghi chú', 'Số tiền', 'Số dư sau giao dịch', 'Thời gian'];
const OVERVIEW_HEADERS = ['Tên tài sản', 'Loại tài sản', 'Đơn vị tiền tệ', 'Số dư', 'Quy đổi(VND)'];
const KNOWN_TYPES = new Set(['Chi tiêu', 'Thu nhập', 'Chuyển khoản', 'Cho mượn', 'Mượn nợ', 'Thu nợ', 'Trả nợ']);
export interface HeDaFile { name: string; buffer: ArrayBuffer }
export interface HeDaIssue { file: string; sheet: string; row: number; message: string }
export interface HeDaWalletPeriod { file: string; wallet: string; start: string; end: string; opening: number; closing: number; sourceCurrent: number; income: number; outgoing: number; rows: number }
export interface HeDaParsed {
  files: { name: string; hash: string; sheets: string[] }[];
  rows: HeDaSourceRow[]; periods: HeDaWalletPeriod[]; walletTypes: Record<string, WalletType>;
  currentBalances: Record<string, number>; sourceAssets: number; sourceNetWorth: number;
  issues: HeDaIssue[]; warnings: string[]; sourceIncome: number; sourceExpense: number;
}
export interface HeDaPreview {
  parsed: HeDaParsed; batchId: string; candidate: DataSnapshot; duplicateRows: number;
  newTransactions: number; newRows: number; issues: HeDaIssue[]; externalWallets: string[];
  requiresDebtPolicy: boolean; report: HeDaReport;
}
export interface HeDaReport {
  sourceRows: number; transactionCount: number; pairedTransfers: number; transferFees: number;
  income: number; expense: number; feeExpense: number; assets: number; netWorth: number;
  receivables: number; liabilities: number; start: string; end: string;
  walletBalances: Record<string, number>; personDebts: Record<string, number>;
  checks: { label: string; status: 'verified' | 'unavailable' | 'failed'; detail: string }[];
  warnings: string[]; debtPolicy: 'FIFO';
  periods: HeDaWalletPeriod[];
}

async function digest(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const stableId = async (prefix: string, value: unknown) => `${prefix}-${await checksum(value)}`;
const cellText = (sheet: XLSX.WorkSheet, cell: string) => String(sheet[cell]?.v ?? '');
export function parseHeDaMoney(raw: unknown) {
  if (typeof raw === 'number') { assertMoney(raw, true); return raw; }
  const match = /^([+-]?)₫(\d+|\d{1,3}(?:,\d{3})+)$/.exec(String(raw).trim());
  if (!match) throw new Error(`Số tiền không đúng dạng export HeDa VND: ${String(raw)}.`);
  const value = Number(`${match[1]}${match[2].replaceAll(',', '')}`);
  assertMoney(value, true); return value;
}
export function parseHeDaTime(raw: string, start: string, end: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) throw new Error(`Thời gian không đúng dd/MM/yy HH:mm: ${raw}.`);
  const [, day, month, shortYear, hour, minute] = match;
  const century = Math.floor(Number(start.slice(0, 4)) / 100) * 100;
  const year = century + Number(shortYear);
  const date = `${year}-${month}-${day}`; assertDate(date);
  if (date < start || date > end) throw new Error(`Ngày ${date} ngoài kỳ xuất ${start} → ${end}.`);
  return { date, time: `${hour}:${minute}` };
}
function parsePeriod(label: string) {
  const match = /^Từ (\d{1,2})\/(\d{4}) đến (\d{1,2})\/(\d{4})$/.exec(label);
  if (!match) throw new Error('Không xác định được kỳ báo cáo HeDa.');
  const start = `${match[2]}-${match[1].padStart(2, '0')}-01`;
  const lastMonth = `${match[4]}-${match[3].padStart(2, '0')}-01`; assertDate(start); assertDate(lastMonth);
  const end = format(endOfMonth(parseISO(lastMonth)), 'yyyy-MM-dd');
  if (start > end) throw new Error('Kỳ báo cáo không hợp lệ.'); return { start, end };
}
export async function inspectHeDaFiles(files: HeDaFile[]): Promise<HeDaParsed> {
  if (!files.length) throw new Error('Chọn ít nhất một file HeDa.');
  const parsed: HeDaParsed = { files: [], rows: [], periods: [], walletTypes: {}, currentBalances: {}, sourceAssets: 0, sourceNetWorth: 0, issues: [], warnings: [], sourceIncome: 0, sourceExpense: 0 };
  let newestEnd = ''; const overviewChecks: { file: string; end: string; difference: number }[] = [];
  const rowIds = new Set<string>(); const fileHashes = new Set<string>();
  for (const file of files) {
    const hash = await digest(file.buffer); if (fileHashes.has(hash)) { parsed.warnings.push(`File ${file.name} trùng nội dung với file đã chọn.`); continue; } fileHashes.add(hash);
    const workbook = XLSX.read(file.buffer, { type: 'array', cellDates: false });
    parsed.files.push({ name: file.name, hash, sheets: workbook.SheetNames });
    const overview = workbook.Sheets['Bảng tổng quan'];
    if (!overview || OVERVIEW_HEADERS.some((h, i) => cellText(overview, `${String.fromCharCode(65 + i)}7`) !== h)) throw new Error(`${file.name}: cấu trúc bảng tổng quan chưa được hỗ trợ. Không nhập bằng suy đoán.`);
    const walletInfo: Record<string, { type: WalletType; balance: number }> = {};
    const typeMap: Record<string, WalletType> = { 'Tiền mặt': 'cash', 'Tài khoản ngân hàng': 'bank', 'Tài sản đầu tư': 'investment', 'Ví điện tử': 'ewallet', 'Tiết kiệm': 'savings', 'Tài sản khác': 'other' };
    const overviewRange = XLSX.utils.decode_range(overview['!ref'] ?? 'A1');
    for (let r = 8; r <= overviewRange.e.r + 1; r++) {
      const name = cellText(overview, `A${r}`); if (!name) continue;
      if (cellText(overview, `C${r}`) !== 'VND' || !typeMap[cellText(overview, `B${r}`)]) throw new Error(`${file.name}/${name}: tiền tệ hoặc loại tài sản chưa được hỗ trợ.`);
      const balance = parseHeDaMoney(overview[`D${r}`]?.v);
      if (parseHeDaMoney(overview[`E${r}`]?.v) !== balance) throw new Error('Số quy đổi VND không khớp số dư ví.');
      walletInfo[name] = { type: typeMap[cellText(overview, `B${r}`)], balance };
      parsed.walletTypes[name] = walletInfo[name].type;
    }
    const sourceAssets = parseHeDaMoney(overview.E4?.v), sourceNetWorth = parseHeDaMoney(overview.E5?.v);
    const overviewDifference = Object.values(walletInfo).reduce((sum, w) => sum + w.balance, 0) - sourceAssets;
    let fileEnd = '';
    for (const name of workbook.SheetNames.filter(n => n !== 'Bảng tổng quan')) {
      const sheet = workbook.Sheets[name];
      if (DETAIL_HEADERS.some((h, i) => cellText(sheet, `${String.fromCharCode(65 + i)}9`) !== h) || cellText(sheet, 'G5') !== 'Số dư đầu kỳ') throw new Error(`${file.name}/${name}: header khác cấu trúc đã kiểm tra.`);
      const walletName = cellText(sheet, 'A5');
      if (walletName !== name || !walletInfo[walletName]) throw new Error(`${file.name}/${name}: ví không khớp overview.`);
      const period = parsePeriod(cellText(sheet, 'A3')); fileEnd = fileEnd > period.end ? fileEnd : period.end;
      const opening = parseHeDaMoney(sheet.H5?.v), sourceCurrent = parseHeDaMoney(sheet.A6?.v);
      const income = parseHeDaMoney(sheet.G7?.v), outgoing = parseHeDaMoney(sheet.H7?.v);
      if (income < 0 || outgoing < 0) throw new Error('Tổng vào/ra phải không âm.');
      const sourceRows: HeDaSourceRow[] = [];
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
      for (let r = 10; r <= range.e.r + 1; r++) {
        const values = Array.from({ length: 8 }, (_, i) => sheet[`${String.fromCharCode(65 + i)}${r}`]?.v ?? '');
        if (values.every(v => v === '')) continue;
        try {
          if (!Number.isSafeInteger(values[0]) || Number(values[0]) !== sourceRows.length + 1) throw new Error('STT không liên tục hoặc không hợp lệ.');
          const originalType = String(values[1]); if (!KNOWN_TYPES.has(originalType)) throw new Error(`Loại chưa hỗ trợ: ${originalType}.`);
          const amount = parseHeDaMoney(values[5]); if (amount === 0) throw new Error('Giao dịch có số tiền 0 cần kiểm tra.');
          if (['Chi tiêu', 'Cho mượn', 'Trả nợ'].includes(originalType) && amount >= 0 || ['Thu nhập', 'Mượn nợ', 'Thu nợ'].includes(originalType) && amount <= 0) throw new Error('Dấu số tiền không khớp loại giao dịch.');
          const originalTime = String(values[7]), timestamp = parseHeDaTime(originalTime, period.start, period.end);
          const category = String(values[2]), subcategory = String(values[3]), note = String(values[4]);
          const balanceAfter = parseHeDaMoney(values[6]);
          const rowId = await stableId('heda-row', [walletName, originalType, category, subcategory, note, amount, balanceAfter, timestamp.date, timestamp.time]);
          const row: HeDaSourceRow = { id: rowId, batchId: '', fileName: file.name, fileHash: hash, sheet: name, row: r, ordinal: Number(values[0]), periodStart: period.start, periodEnd: period.end, walletName, originalType, category, subcategory, note, amount, balanceAfter, ...timestamp, originalTime, transactionIds: [] };
          sourceRows.push(row);
        } catch (error) { parsed.issues.push({ file: file.name, sheet: name, row: r, message: error instanceof Error ? error.message : 'Dòng không hợp lệ' }); }
      }
      let closing = opening, sourceIn = 0, sourceOut = 0;
      for (const row of [...sourceRows].reverse()) {
        closing += row.amount; sourceIn += Math.max(0, row.amount); sourceOut += Math.max(0, -row.amount);
        if (closing !== row.balanceAfter) parsed.issues.push({ file: file.name, sheet: name, row: row.row, message: `Số dư sau giao dịch lệch ${closing - row.balanceAfter} VND.` });
        if (!rowIds.has(row.id)) { parsed.rows.push(row); rowIds.add(row.id); if (row.originalType === 'Thu nhập') parsed.sourceIncome += row.amount; if (row.originalType === 'Chi tiêu') parsed.sourceExpense -= row.amount; }
      }
      if (income !== sourceIn || outgoing !== sourceOut) parsed.issues.push({ file: file.name, sheet: name, row: 7, message: 'Tổng vào/ra không khớp tất cả dòng giao dịch.' });
      parsed.periods.push({ file: file.name, wallet: name, ...period, opening, closing, sourceCurrent, income, outgoing, rows: sourceRows.length });
    }
    for (const wallet of Object.keys(walletInfo)) if (!workbook.Sheets[wallet]) parsed.issues.push({ file: file.name, sheet: wallet, row: 7, message: 'Overview có ví nhưng thiếu bảng chi tiết.' });
    overviewChecks.push({ file: file.name, end: fileEnd, difference: overviewDifference });
    if (fileEnd >= newestEnd) { newestEnd = fileEnd; parsed.currentBalances = Object.fromEntries(Object.entries(walletInfo).map(([name, w]) => [name, w.balance])); parsed.sourceAssets = sourceAssets; parsed.sourceNetWorth = sourceNetWorth; }
  }
  for (const check of overviewChecks.filter(c => c.difference !== 0)) {
    if (check.end === newestEnd) parsed.issues.push({ file: check.file, sheet: 'Bảng tổng quan', row: 4, message: `Tổng tài sản overview mới nhất lệch ${check.difference} VND.` });
    else parsed.warnings.push(`${check.file}: snapshot overview cũ lệch ${check.difference} VND so với tổng các ví. Sổ chi tiết từng kỳ được đối chiếu riêng; số dư hiện tại lấy từ overview kỳ mới nhất.`);
  }
  for (const name of Object.keys(parsed.walletTypes)) {
    const periods = parsed.periods.filter(p => p.wallet === name).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < periods.length; i++) if (periods[i].start > periods[i - 1].end && periods[i].opening !== periods[i - 1].closing) parsed.issues.push({ file: periods[i].file, sheet: name, row: 5, message: 'Số dư đầu kỳ không khớp cuối kỳ báo cáo trước.' });
    const latest = periods.at(-1); if (latest && latest.closing !== parsed.currentBalances[name]) parsed.issues.push({ file: latest.file, sheet: name, row: 6, message: 'Số dư cuối lịch sử không khớp overview mới nhất.' });
  }
  return parsed;
}

export async function prepareHeDaImport(parsed: HeDaParsed, existing?: DataSnapshot): Promise<HeDaPreview> {
  const currentData = existing ?? await snapshot();
  const issues = [...parsed.issues]; const externalWallets = new Set<string>();
  const batchId = await stableId('heda-batch', parsed.files.map(f => f.hash).sort());
  const importedAt = currentData.importBatches.find(b => b.id === batchId)?.importedAt ?? now();
  const rows = structuredClone(parsed.rows).map(r => ({ ...r, batchId }));
  const existingTransactions = new Map(currentData.transactions.map(t => [t.id, t]));
  const wallets: Wallet[] = [], categories: Category[] = [], transactions: Transaction[] = [], debts: Debt[] = [], payments: DebtPayment[] = [];
  const walletByName = new Map<string, Wallet>();
  const issue = (row: HeDaSourceRow, message: string) => issues.push({ file: row.fileName, sheet: row.sheet, row: row.row, message });
  for (const [name, type] of Object.entries(parsed.walletTypes)) {
    const opening = parsed.periods.filter(p => p.wallet === name).sort((a, b) => a.start.localeCompare(b.start))[0]?.opening;
    if (opening === undefined) throw new Error(`Thiếu số dư đầu kỳ: ${name}.`);
    const current = currentData.wallets.find(w => w.name === name);
    if (current && current.openingBalance !== opening) issues.push({ file: '', sheet: name, row: 5, message: 'Ví hiện có khác số dư đầu kỳ nguồn. Không tự ghi đè.' });
    const wallet: Wallet = current ?? { id: await stableId('heda-wallet', name), name, type, icon: type === 'cash' ? '💵' : type === 'bank' ? '🏦' : '🌱', openingBalance: opening, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: importedAt, balanceVerified: true };
    wallets.push(wallet); walletByName.set(name, wallet);
  }
  async function ensureWallet(name: string) {
    let wallet = walletByName.get(name); if (wallet) return wallet;
    externalWallets.add(name);
    wallet = currentData.wallets.find(w => w.name === name) ?? { id: await stableId('heda-wallet', name), name, type: 'other', icon: '👛', openingBalance: 0, currency: 'VND', includeInNetWorth: false, archived: true, createdAt: importedAt, balanceVerified: false };
    if (wallet.includeInNetWorth || wallet.balanceVerified !== false) issues.push({ file: '', sheet: name, row: 0, message: 'Ví thiếu sổ nguồn đang tính tài sản hoặc chưa đánh dấu số dư chưa xác minh.' });
    wallets.push(wallet); walletByName.set(name, wallet); return wallet;
  }
  async function category(name: string, type: 'income' | 'expense', parentId?: string) {
    const known = [...currentData.categories, ...categories].find(c => c.name === name && c.type === type && c.parentId === parentId); if (known) return known;
    const c: Category = { id: await stableId('heda-category', [type, parentId ?? '', name]), name, type, parentId, icon: type === 'income' ? '💰' : '✨', color: type === 'income' ? '#6da68c' : '#86a898', sortOrder: currentData.categories.length + categories.length, archived: false }; categories.push(c); return c;
  }
  async function createTx(sourceRows: HeDaSourceRow[], fields: Omit<Parameters<typeof makeTransaction>[0], 'id' | 'createdAt' | 'source'>, suffix = '') {
    const sourceId = `${sourceRows.map(r => r.id).sort().join('|')}${suffix}`;
    const transactionId = await stableId('heda-tx', sourceId);
    const tx = existingTransactions.get(transactionId) ?? makeTransaction({ ...fields, id: transactionId, createdAt: importedAt, source: 'heda', sourceId: await checksum(sourceId), sourceFile: sourceRows[0].fileName, sourceSheet: sourceRows[0].sheet, sourceRow: sourceRows[0].row, importBatchId: batchId, fingerprint: `heda:${await checksum(sourceId)}` });
    if (!transactions.some(t => t.id === tx.id)) transactions.push(tx);
    for (const row of sourceRows) if (!row.transactionIds.includes(tx.id)) row.transactionIds.push(tx.id);
    return tx;
  }
  const transferRows = rows.filter(r => r.originalType === 'Chuyển khoản');
  const feeRows = transferRows.filter(r => r.note === 'Phí chuyển khoản');
  const principals = transferRows.filter(r => r.note !== 'Phí chuyển khoản');
  const transferGroups = new Map<string, { from: string; to: string; outs: HeDaSourceRow[]; ins: HeDaSourceRow[] }>();
  for (const row of principals) {
    const prefix = row.amount < 0 ? 'Đến ' : 'Từ ';
    if (!row.category.startsWith(prefix)) { issue(row, 'Chuyển khoản thiếu tên ví đối ứng.'); continue; }
    const peer = row.category.slice(prefix.length); if (!peer || peer === row.walletName) { issue(row, 'Ví đối ứng không hợp lệ.'); continue; }
    const from = row.amount < 0 ? row.walletName : peer, to = row.amount < 0 ? peer : row.walletName;
    await ensureWallet(from); await ensureWallet(to);
    const groupKey = JSON.stringify([row.date, row.time, Math.abs(row.amount), from, to]);
    const group = transferGroups.get(groupKey) ?? { from, to, outs: [], ins: [] };
    (row.amount < 0 ? group.outs : group.ins).push(row); transferGroups.set(groupKey, group);
  }
  const feesByPrincipal = new Map<string, HeDaSourceRow[]>();
  for (const fee of feeRows) {
    if (fee.amount >= 0 || !fee.category.startsWith('Đến ')) { issue(fee, 'Phí chuyển khoản không hợp lệ.'); continue; }
    const candidates = principals.filter(r => r.amount < 0 && r.walletName === fee.walletName && r.category === fee.category && r.date === fee.date && r.time === fee.time);
    const adjacent = candidates.filter(r => Math.abs(r.ordinal - fee.ordinal) === 1);
    const chosen = adjacent.length === 1 ? adjacent[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (!chosen) { issue(fee, 'Không xác định duy nhất chuyển khoản gốc của phí.'); continue; }
    const linked = feesByPrincipal.get(chosen.id) ?? []; linked.push(fee); feesByPrincipal.set(chosen.id, linked);
  }
  let pairedTransfers = 0;
  for (const group of transferGroups.values()) {
    const count = Math.max(group.outs.length, group.ins.length);
    if (walletByName.get(group.from)?.balanceVerified !== false && walletByName.get(group.to)?.balanceVerified !== false && group.outs.length !== group.ins.length) {
      for (const r of [...group.outs, ...group.ins]) issue(r, 'Không đủ hai vế chuyển khoản giữa các ví có sổ nguồn.'); continue;
    }
    for (let i = 0; i < count; i++) {
      const out = group.outs[i], incoming = group.ins[i], fee = out ? feesByPrincipal.get(out.id) ?? [] : [];
      const primary = out ?? incoming; if (out && incoming) pairedTransfers++;
      const originals = [out, incoming, ...fee].filter(Boolean) as HeDaSourceRow[];
      await createTx(originals, { type: 'transfer', amount: Math.abs(primary.amount), walletId: walletByName.get(group.from)!.id, destinationWalletId: walletByName.get(group.to)!.id, transferFee: fee.reduce((sum, f) => sum - f.amount, 0), feeWalletId: walletByName.get(group.from)!.id, date: primary.date, time: primary.time, note: [...new Set(originals.filter(r => r.note && r.note !== 'Phí chuyển khoản').map(r => r.note))].join(' / '), includeInReports: true });
    }
  }
  const balancesByPerson = new Map<string, { debt: Debt; remaining: number; time: string }[]>();
  const chronological = rows.filter(r => r.originalType !== 'Chuyển khoản').sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.walletName === b.walletName ? b.ordinal - a.ordinal : Number(['Thu nợ', 'Trả nợ'].includes(a.originalType)) - Number(['Thu nợ', 'Trả nợ'].includes(b.originalType)) || a.walletName.localeCompare(b.walletName)));
  for (const row of chronological) {
    try {
      const walletId = walletByName.get(row.walletName)!.id;
      if (row.originalType === 'Chi tiêu' || row.originalType === 'Thu nhập') {
        const type = row.originalType === 'Chi tiêu' ? 'expense' : 'income';
        if (!row.category) throw new Error('Thu/chi thiếu danh mục gốc.');
        const parent = await category(row.category, type); const selected = row.subcategory ? await category(row.subcategory, type, parent.id) : parent;
        await createTx([row], { type, amount: Math.abs(row.amount), walletId, categoryId: selected.id, date: row.date, time: row.time, note: row.note, includeInReports: true });
      } else if (row.originalType === 'Cho mượn' || row.originalType === 'Mượn nợ') {
        const kind = row.originalType === 'Cho mượn' ? 'lend' : 'borrow';
        const person = (kind === 'lend' ? /^Cho (.+) mượn$/ : /^Mượn của (.+)$/).exec(row.category)?.[1]; if (!person) throw new Error('Không xác định được người trong khoản vay.');
        const debtId = await stableId('heda-debt', row.id);
        const tx = await createTx([row], { type: kind, amount: Math.abs(row.amount), walletId, date: row.date, time: row.time, note: row.note, debtId, includeInReports: false });
        const debt = currentData.debts.find(d => d.id === debtId) ?? { id: debtId, kind, personName: person, originalAmount: Math.abs(row.amount), date: row.date, note: row.note, walletId, transactionId: tx.id };
        debts.push(debt); const key = `${kind}:${person}`; const group = balancesByPerson.get(key) ?? []; group.push({ debt, remaining: debt.originalAmount, time: row.time }); balancesByPerson.set(key, group);
      } else {
        const kind = row.originalType === 'Thu nợ' ? 'lend' : 'borrow';
        const person = (kind === 'lend' ? /^Thu nợ từ (.+)$/ : /^Trả nợ cho (.+)$/).exec(row.note)?.[1]; if (!person) throw new Error('Không xác định được người trong thanh toán nợ.');
        const group = balancesByPerson.get(`${kind}:${person}`) ?? [];
        let remaining = Math.abs(row.amount); const available = group.reduce((sum, d) => sum + d.remaining, 0);
        if (remaining > available) throw new Error(`Thanh toán vượt khoản nợ nguồn đã biết của ${person}: thiếu ${remaining - available} VND. Cần thêm lịch sử trước đó.`);
        for (const item of group.filter(d => d.remaining > 0)) {
          const amount = Math.min(remaining, item.remaining);
          const tx = await createTx([row], { type: 'debt-payment', amount, walletId, date: row.date, time: row.time, note: row.note, debtId: item.debt.id, paymentDirection: kind === 'lend' ? 'in' : 'out', includeInReports: false }, `:${item.debt.id}`);
          const paymentId = await stableId('heda-payment', [row.id, item.debt.id]);
          payments.push(currentData.debtPayments.find(p => p.id === paymentId) ?? { id: paymentId, debtId: item.debt.id, transactionId: tx.id, amount, date: row.date });
          item.remaining -= amount; remaining -= amount; if (!remaining) break;
        }
      }
    } catch (error) { issue(row, error instanceof Error ? error.message : 'Lỗi chuyển đổi'); }
  }
  for (const row of rows) if (!row.transactionIds.length) issue(row, 'Dòng nguồn chưa có giao dịch tương ứng.');
  const roots = new Map(rows.map(r => [r.id, r.id]));
  const rootOf = (key: string): string => { let root = key; while (roots.get(root) !== root) root = roots.get(root)!; roots.set(key, root); return root; };
  const transactionOwners = new Map<string, string>();
  for (const row of rows) for (const transactionId of row.transactionIds) { const owner = transactionOwners.get(transactionId); if (owner) roots.set(rootOf(row.id), rootOf(owner)); else transactionOwners.set(transactionId, row.id); }
  const components = new Map<string, HeDaSourceRow[]>();
  for (const row of rows) { const key = rootOf(row.id); const group = components.get(key) ?? []; group.push(row); components.set(key, group); }
  const txById = new Map(transactions.map(t => [t.id, t]));
  for (const originals of components.values()) {
    const expected = new Map<string, number>(), actual = new Map<string, number>();
    for (const row of originals) expected.set(row.walletName, (expected.get(row.walletName) ?? 0) + row.amount);
    for (const transactionId of new Set(originals.flatMap(r => r.transactionIds))) {
      const tx = txById.get(transactionId)!;
      for (const [walletId, amount] of walletEffects(tx)) { const walletName = wallets.find(w => w.id === walletId)?.name; if (walletName) actual.set(walletName, (actual.get(walletName) ?? 0) + amount); }
    }
    for (const name of new Set([...expected.keys(), ...actual.keys()])) if (parsed.walletTypes[name] && (expected.get(name) ?? 0) !== (actual.get(name) ?? 0)) issue(originals[0], `Bút toán ghép/tách lệch ${name}: ${(actual.get(name) ?? 0) - (expected.get(name) ?? 0)} VND.`);
  }
  const knownBalances: Record<string, number> = Object.fromEntries(wallets.map(w => [w.name, w.openingBalance]));
  const walletNames = new Map(wallets.map(w => [w.id, w.name])); let income = 0, expense = 0, feeExpense = 0;
  for (const tx of transactions) {
    for (const [walletId, amount] of walletEffects(tx)) { const name = walletNames.get(walletId); if (name) knownBalances[name] += amount; }
    const values = reportAmounts(tx); income += values.income; if (tx.type === 'transfer') feeExpense += values.expense; else expense += values.expense;
  }
  for (const [name, expected] of Object.entries(parsed.currentBalances)) if (knownBalances[name] !== expected) issues.push({ file: '', sheet: name, row: 0, message: `Số dư sau chuyển đổi lệch ${knownBalances[name] - expected} VND.` });
  if (income !== parsed.sourceIncome || expense !== parsed.sourceExpense) issues.push({ file: '', sheet: '', row: 0, message: 'Tổng thu/chi sau chuyển đổi không khớp loại thu/chi gốc.' });
  const personDebts: Record<string, number> = {}; let receivables = 0, liabilities = 0;
  for (const [key, group] of balancesByPerson) {
    const balance = group.reduce((sum, d) => sum + d.remaining, 0); personDebts[key] = balance;
    if (key.startsWith('lend:')) receivables += balance; else liabilities += balance;
  }
  const assets = wallets.filter(w => w.includeInNetWorth).reduce((sum, w) => sum + knownBalances[w.name], 0), netWorth = assets + receivables - liabilities;
  if (assets !== parsed.sourceAssets || netWorth !== parsed.sourceNetWorth) issues.push({ file: '', sheet: 'Bảng tổng quan', row: 4, message: `Tài sản hoặc tài sản ròng không khớp: ${assets - parsed.sourceAssets} / ${netWorth - parsed.sourceNetWorth} VND.` });
  const report: HeDaReport = { sourceRows: rows.length, transactionCount: transactions.length, pairedTransfers, transferFees: feeRows.length, income, expense, feeExpense, assets, netWorth, receivables, liabilities, start: rows.map(r => r.date).sort()[0] ?? '', end: rows.map(r => r.date).sort().at(-1) ?? '', walletBalances: knownBalances, personDebts, debtPolicy: 'FIFO', periods: parsed.periods, warnings: [...parsed.warnings, ...(externalWallets.size ? ['Ví thiếu sổ nguồn chỉ lưu biến động đã biết, không xác minh số dư đầu kỳ và không tính tổng tài sản.'] : []), ...(payments.length ? ['Liên kết từng thanh toán nợ dùng FIFO vì export không có ID khoản nợ. Tổng dư nợ được đối chiếu với tài sản ròng nguồn.'] : [])], checks: [
    { label: 'Bảo toàn dòng nguồn và biến động từng bút toán', status: 'verified', detail: `${rows.length} dòng gốc → ${transactions.length} giao dịch; có bảng liên kết để xem từng dòng.` },
    { label: 'Từng số dư sau giao dịch và tổng vào/ra các kỳ', status: 'verified', detail: `${parsed.periods.length} bảng ví/kỳ` },
    { label: 'Tổng thu nhập và chi tiêu gốc', status: 'verified', detail: 'Giữ nguyên loại Chi tiêu/Thu nhập, gồm các điều chỉnh đã được HeDa xếp vào thu/chi.' },
    { label: 'Số dư các ví có sổ nguồn', status: 'verified', detail: `${Object.keys(parsed.currentBalances).length} ví` },
    { label: 'Ghép chuyển khoản và phí', status: 'verified', detail: `${pairedTransfers} cặp hai vế; ${feeRows.length} dòng phí` },
    { label: 'Tổng tài sản và tài sản ròng', status: 'verified', detail: 'Đối chiếu độc lập với bảng tổng quan nguồn.' },
    ...(externalWallets.size ? [{ label: 'Số dư đầu kỳ ví thiếu sổ nguồn', status: 'unavailable' as const, detail: [...externalWallets].join(', ') }] : []),
    ...(payments.length ? [{ label: 'ID liên kết khoản nợ gốc', status: 'unavailable' as const, detail: 'File không xuất ID; sử dụng FIFO sau xác nhận.' }] : []),
    ...(parsed.warnings.length ? [{ label: 'Snapshot tổng quan của các kỳ cũ', status: 'unavailable' as const, detail: parsed.warnings.join('\n') }] : []),
  ] };
  if (issues.length) for (const check of report.checks) if (check.status === 'verified') check.status = 'failed';
  const merge = <T extends { id: string }>(old: T[], incoming: T[]) => { const all = new Map(old.map(row => [row.id, row])); for (const row of incoming) if (!all.has(row.id)) all.set(row.id, row); return [...all.values()]; };
  const newTransactions = transactions.filter(t => !existingTransactions.has(t.id)).length;
  const existingRowIds = new Set(currentData.hedaSourceRows.map(r => r.id)); const duplicateRows = rows.filter(r => existingRowIds.has(r.id)).length;
  const candidate: DataSnapshot = { ...currentData, wallets: merge(currentData.wallets, wallets), categories: merge(currentData.categories, categories), transactions: merge(currentData.transactions, transactions), debts: merge(currentData.debts, debts), debtPayments: merge(currentData.debtPayments, payments), hedaSourceRows: merge(currentData.hedaSourceRows, rows), importBatches: merge(currentData.importBatches, [{ id: batchId, source: 'heda', sourceFile: parsed.files.map(f => f.name).join('; '), importedAt, count: newTransactions, income, expense: expense + feeExpense, sourceRowCount: rows.length, reconciliation: JSON.stringify(report) }]) };
  if (!issues.length) validateSnapshot(candidate);
  return { parsed, batchId, candidate, duplicateRows, newTransactions, newRows: rows.length - duplicateRows, externalWallets: [...externalWallets], requiresDebtPolicy: payments.length > 0, issues, report };
}

export async function commitHeDaImport(preview: HeDaPreview, approvals: { fifo: boolean; externalWallets: boolean }) {
  if (preview.issues.length) throw new Error('Còn lỗi đối chiếu. Không nhập hoặc bỏ qua dòng lỗi.');
  if (preview.requiresDebtPolicy && !approvals.fifo || preview.externalWallets.length && !approvals.externalWallets) throw new Error('Cần xác nhận cách gán thanh toán nợ và ví thiếu sổ nguồn.');
  if (!preview.newRows) throw new Error('Tất cả dòng nguồn đã có. Không tạo dữ liệu trùng.');
  const before = await snapshot();
  // WebCrypto hashing happens before the IDB transaction so it cannot cause premature commit.
  const refreshed = await prepareHeDaImport(preview.parsed, before);
  if (refreshed.issues.length || refreshed.newRows !== preview.newRows || refreshed.newTransactions !== preview.newTransactions) throw new Error('Database thay đổi sau preview. Xem lại trước khi nhập.');
  await db.transaction('rw', db.tables, async () => {
    if (JSON.stringify(await snapshot()) !== JSON.stringify(before)) throw new Error('Database thay đổi trong lúc kiểm tra. Xem lại preview.');
    validateSnapshot(refreshed.candidate);
    // Add only missing IDs. Existing records, preferences and user-entered transactions are preserved.
    for (const name of ['wallets', 'categories', 'transactions', 'debts', 'debtPayments', 'hedaSourceRows', 'importBatches'] as const) {
      const table = db.table(name); const currentIds = new Set(await table.toCollection().primaryKeys());
      await table.bulkAdd(refreshed.candidate[name].filter(row => !currentIds.has(row.id)));
    }
    await validateSnapshot(await snapshot());
    if (await db.hedaSourceRows.where('batchId').equals(preview.batchId).count() !== preview.newRows) throw new Error('Số dòng nguồn được lưu không khớp. Rollback toàn bộ batch.');
  });
  return preview.report;
}

export class HeDaImportAdapter {
  inspect = inspectHeDaFiles;
  prepare = prepareHeDaImport;
  commit = commitHeDaImport;
}

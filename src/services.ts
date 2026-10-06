import { db } from './db';
import type { Transaction, TransactionType, Wallet, Category, RecurringTransaction } from './types';
import { assertDate, assertMoney, id, now, today, walletEffects, reportAmounts, nextOccurrence } from './finance';
import { groupDebtsByPerson, normalizePersonName } from './debt-groups';

export type TransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'walletIds' | 'tags' | 'transferFee' | 'includeInReports' | 'note' | 'time'> & Partial<Pick<Transaction, 'id' | 'createdAt' | 'tags' | 'transferFee' | 'includeInReports' | 'note' | 'time'>> & { personName?: string; dueDate?: string };
export function makeTransaction(input: TransactionInput): Transaction {
  return { ...input, id: input.id ?? id(), createdAt: input.createdAt ?? now(), updatedAt: now(),
    transferFee: input.transferFee ?? 0, includeInReports: input.includeInReports ?? true,
    time: input.time ?? '12:00', note: input.note ?? '', tags: [...new Set(input.tags ?? [])],
    walletIds: [...new Set([input.walletId, input.destinationWalletId, input.type === 'transfer' ? (input.feeWalletId ?? input.walletId) : undefined].filter(Boolean))] as string[],
  };
}
async function validateTransaction(tx: Transaction, allowArchived = false) {
  assertMoney(tx.amount, tx.type === 'adjustment'); assertDate(tx.date);
  if (tx.note.length > 100000 || tx.tags.some(t => !t.trim() || t.length > 200 || /[,#]/.test(t))) throw new Error('Ghi chú hoặc tag vượt giới hạn hợp lệ.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tx.time)) throw new Error('Giờ không hợp lệ.');
  for (const walletId of tx.walletIds) {
    const wallet = await db.wallets.get(walletId);
    if (!wallet || (!allowArchived && wallet.archived)) throw new Error('Ví không tồn tại hoặc đã lưu trữ.');
    if (wallet.currency !== 'VND') throw new Error('Phiên bản này chỉ hỗ trợ giao dịch VND.');
  }
  if (tx.type === 'income' || tx.type === 'expense') {
    const category = tx.categoryId ? await db.categories.get(tx.categoryId) : undefined;
    if (!category || category.type !== tx.type || (!allowArchived && category.archived)) throw new Error('Vui lòng chọn danh mục đúng loại.');
  }
  if (tx.eventId && !await db.events.get(tx.eventId)) throw new Error('Sự kiện không tồn tại.');
  if (tx.type === 'transfer') {
    if (!tx.destinationWalletId || tx.destinationWalletId === tx.walletId) throw new Error('Ví nhận phải khác ví gửi.');
    if (!Number.isSafeInteger(tx.transferFee) || tx.transferFee < 0) throw new Error('Phí chuyển khoản không hợp lệ.');
  }
}
async function syncTransactionTags(tx: Transaction) {
  await db.transactionTags.where('transactionId').equals(tx.id).delete();
  for (const name of tx.tags) {
    let tag = await db.tags.where('name').equals(name).first();
    if (!tag) { tag = { id: id(), name }; await db.tags.add(tag); }
    await db.transactionTags.put({ id: `${tx.id}:${tag.id}`, transactionId: tx.id, tagId: tag.id });
  }
}
export async function saveTransaction(input: TransactionInput) {
  return db.transaction('rw', [db.transactions, db.wallets, db.categories, db.debts, db.debtPayments, db.settings, db.tags, db.transactionTags, db.events], async () => {
    const tx = makeTransaction(input);
    const old = await db.transactions.get(tx.id);
    if (old?.deletedAt) throw new Error('Khôi phục giao dịch trước khi chỉnh sửa.');
    if (old && old.type !== tx.type) throw new Error('Không thể đổi loại của giao dịch đã lưu.');
    if (tx.type === 'debt-payment') throw new Error('Dùng chức năng trả / thu nợ để ghi nhận thanh toán.');
    await validateTransaction(tx, !!old);
    if (tx.type === 'borrow' || tx.type === 'lend') {
      if (!input.personName?.trim()) throw new Error('Vui lòng nhập tên người cho vay / người vay.');
      if (input.dueDate) { assertDate(input.dueDate); if (input.dueDate < tx.date) throw new Error('Hạn trả phải sau ngày vay.'); }
      const debtId = old?.debtId ?? id(); tx.debtId = debtId;
      const existingDebt = await db.debts.get(debtId);
      if (existingDebt && await db.debtPayments.where('debtId').equals(debtId).count()) throw new Error('Khoản nợ đã có thanh toán; không thể thay đổi bút toán gốc.');
      await db.debts.put({ id: debtId, kind: tx.type, personName: input.personName.trim(), originalAmount: tx.amount, date: tx.date, dueDate: input.dueDate || undefined, note: tx.note, walletId: tx.walletId, transactionId: tx.id });
    }
    await db.transactions.put(tx); await syncTransactionTags(tx);
    await db.settings.update('app', { defaultWalletId: tx.walletId, ...(tx.categoryId ? { lastCategoryId: tx.categoryId } : {}) });
    return tx.id;
  });
}
export async function getBalances(atDate?: string): Promise<Record<string, number>> {
  const wallets = await db.wallets.toArray();
  const balances: Record<string, number> = Object.fromEntries(wallets.map(w => [w.id, w.openingBalance]));
  const collection = atDate ? db.transactions.where('date').belowOrEqual(atDate) : db.transactions.toCollection();
  await collection.each(tx => { for (const [walletId, change] of walletEffects(tx)) balances[walletId] = (balances[walletId] ?? 0) + change; });
  return balances;
}
export async function getWalletBalance(walletId: string) {
  const wallet = await db.wallets.get(walletId); if (!wallet) throw new Error('Không tìm thấy ví.');
  let balance = wallet.openingBalance;
  await db.transactions.where('walletIds').equals(walletId).each(tx => { balance += walletEffects(tx).get(walletId) ?? 0; });
  return balance;
}
export async function adjustBalance(walletId: string, actualBalance: number, date = today()) {
  assertMoney(actualBalance, true);
  return db.transaction('rw', db.wallets, db.transactions, async () => {
    const difference = actualBalance - await getWalletBalance(walletId);
    const wallet = await db.wallets.get(walletId);
    if (!difference && wallet?.balanceVerified !== false) throw new Error('Số dư đã khớp, không cần điều chỉnh.');
    const tx = makeTransaction({ type: 'adjustment', amount: difference, walletId, date, includeInReports: false, note: `Đối chiếu số dư thực tế: ${actualBalance} VND` });
    await validateTransaction(tx); await db.transactions.add(tx); await db.wallets.update(walletId, { balanceVerified: true });
  });
}
export async function trashTransaction(transactionId: string) {
  await db.transaction('rw', db.transactions, db.debts, db.debtPayments, async () => {
    const tx = await db.transactions.get(transactionId); if (!tx) throw new Error('Không tìm thấy giao dịch.');
    if (tx.type === 'borrow' || tx.type === 'lend') {
      const payments = await db.debtPayments.where('debtId').equals(tx.debtId!).toArray();
      for (const payment of payments) if (!(await db.transactions.get(payment.transactionId))?.deletedAt) throw new Error('Chuyển các thanh toán của khoản nợ vào thùng rác trước.');
    }
    await db.transactions.update(transactionId, { deletedAt: now(), updatedAt: now() });
  });
}
export async function restoreTransaction(transactionId: string) {
  await db.transaction('rw', [db.transactions, db.debts, db.debtPayments, db.wallets, db.categories, db.events], async () => {
    const tx = await db.transactions.get(transactionId); if (!tx) throw new Error('Không tìm thấy giao dịch.');
    if (tx.type === 'debt-payment') {
      const debt = await db.debts.get(tx.debtId!);
      const origin = debt && await db.transactions.get(debt.transactionId);
      if (!debt || !origin || origin.deletedAt) throw new Error('Khôi phục khoản nợ gốc trước.');
      if (tx.amount > await debtRemaining(debt.id)) throw new Error('Khôi phục sẽ làm trả vượt số nợ còn lại.');
    }
    await validateTransaction(tx, true);
    await db.transactions.update(tx.id, { deletedAt: undefined, updatedAt: now() });
  });
}
export async function permanentDelete(transactionId: string) {
  await db.transaction('rw', db.transactions, db.debts, db.debtPayments, db.transactionTags, db.hedaSourceRows, async () => {
    const tx = await db.transactions.get(transactionId); if (!tx?.deletedAt) throw new Error('Chỉ xóa vĩnh viễn giao dịch trong thùng rác.');
    if (tx.type === 'borrow' || tx.type === 'lend') {
      if (await db.debtPayments.where('debtId').equals(tx.debtId!).count()) throw new Error('Xóa các thanh toán trong thùng rác trước khi xóa nợ gốc.');
      await db.debts.delete(tx.debtId!);
    }
    await db.debtPayments.where('transactionId').equals(tx.id).delete();
    await db.transactionTags.where('transactionId').equals(tx.id).delete();
    await db.hedaSourceRows.where('transactionIds').equals(tx.id).modify(row => { row.transactionIds = row.transactionIds.filter(id => id !== tx.id); row.purgedTransactionIds = [...new Set([...(row.purgedTransactionIds ?? []), tx.id])]; });
    await db.transactions.delete(tx.id);
  });
}
export async function emptyTrash() {
  await db.transaction('rw', db.transactions, db.debts, db.debtPayments, db.transactionTags, db.hedaSourceRows, async () => {
    const trashed = await db.transactions.filter(tx => !!tx.deletedAt).toArray();
    for (const tx of trashed.filter(t => t.type === 'debt-payment')) await permanentDelete(tx.id);
    for (const tx of trashed.filter(t => t.type !== 'debt-payment')) await permanentDelete(tx.id);
  });
}
export async function duplicateTransaction(tx: Transaction) {
  if (['borrow', 'lend', 'debt-payment', 'adjustment'].includes(tx.type)) throw new Error('Khoản nợ / điều chỉnh cần tạo mới để kiểm tra kế toán.');
  const { id: _id, createdAt: _created, deletedAt: _deleted, recurringKey: _key, sourceId: _sourceId, fingerprint: _fp, source: _source, sourceFile: _file, importBatchId: _batch, ...rest } = tx;
  return saveTransaction({ ...rest, date: today() });
}
export async function saveWallet(wallet: Wallet) {
  if (!wallet.name.trim()) throw new Error('Vui lòng nhập tên ví.'); assertMoney(wallet.openingBalance, true);
  if (wallet.currency !== 'VND') throw new Error('Chỉ hỗ trợ ví VND trong phiên bản này.');
  if (wallet.balanceVerified === false && wallet.includeInNetWorth) throw new Error('Đối chiếu số dư thực tế trước khi tính ví chưa xác minh vào tài sản.');
  await db.transaction('rw', db.wallets, db.transactions, async () => {
    const old = await db.wallets.get(wallet.id);
    if (old && old.openingBalance !== wallet.openingBalance && await db.transactions.where('walletIds').equals(wallet.id).count()) throw new Error('Ví đã có lịch sử. Hãy dùng Điều chỉnh số dư để đối chiếu.');
    await db.wallets.put({ ...wallet, name: wallet.name.trim() });
  });
}
export async function deleteWallet(walletId: string) {
  await db.transaction('rw', db.wallets, db.transactions, db.debts, db.recurring, db.settings, async () => {
    if (await db.transactions.where('walletIds').equals(walletId).count() || await db.debts.filter(d => d.walletId === walletId).count() || await db.recurring.filter(r => r.walletId === walletId).count()) throw new Error('Ví đang được sử dụng. Bạn có thể lưu trữ ví thay vì xóa.');
    await db.wallets.delete(walletId);
    if ((await db.settings.get('app'))?.defaultWalletId === walletId) await db.settings.update('app', { defaultWalletId: undefined });
  });
}
export async function setWalletArchived(walletId: string, archived: boolean) {
  await db.transaction('rw', db.wallets, db.recurring, db.settings, async () => {
    if (!await db.wallets.get(walletId)) throw new Error('Ví không tồn tại.');
    await db.wallets.update(walletId, { archived });
    if (archived) {
      await db.recurring.filter(r => r.walletId === walletId).modify({ archived: true });
      if ((await db.settings.get('app'))?.defaultWalletId === walletId) {
        const nextWallet = await db.wallets.filter(w => !w.archived).first();
        await db.settings.update('app', { defaultWalletId: nextWallet?.id });
      }
    }
  });
}
export async function setCategoryArchived(categoryId: string, archived: boolean) {
  await db.transaction('rw', db.categories, db.recurring, db.settings, async () => {
    await db.categories.update(categoryId, { archived });
    if (archived) {
      await db.recurring.filter(r => r.categoryId === categoryId).modify({ archived: true });
      if ((await db.settings.get('app'))?.lastCategoryId === categoryId) await db.settings.update('app', { lastCategoryId: undefined });
    }
  });
}
export async function deleteCategory(categoryId: string, mergeId?: string) {
  await db.transaction('rw', db.categories, db.transactions, db.budgets, db.recurring, db.settings, async () => {
    const source = await db.categories.get(categoryId); if (!source) throw new Error('Danh mục không tồn tại.');
    if (await db.categories.where('parentId').equals(categoryId).count()) throw new Error('Chuyển hoặc lưu trữ danh mục con trước.');
    const used = await db.transactions.where('categoryId').equals(categoryId).count() || await db.budgets.where('categoryId').equals(categoryId).count() || await db.recurring.filter(r => r.categoryId === categoryId).count();
    if (used && !mergeId) throw new Error('Danh mục đang được dùng. Chọn danh mục thay thế để gộp hoặc lưu trữ.');
    if (mergeId) {
      const target = await db.categories.get(mergeId);
      if (!target || target.type !== source.type || target.id === source.id || target.archived) throw new Error('Chọn danh mục thay thế cùng loại.');
      await db.transactions.where('categoryId').equals(categoryId).modify({ categoryId: mergeId });
      await db.budgets.where('categoryId').equals(categoryId).modify({ categoryId: mergeId });
      await db.recurring.filter(r => r.categoryId === categoryId).modify({ categoryId: mergeId });
    }
    await db.categories.delete(categoryId);
    if ((await db.settings.get('app'))?.lastCategoryId === categoryId) await db.settings.update('app', { lastCategoryId: mergeId || undefined });
  });
}
export async function saveCategory(category: Category) {
  if (!category.name.trim()) throw new Error('Nhập tên danh mục.');
  await db.transaction('rw', db.categories, async () => {
    if (category.parentId) {
      const parent = await db.categories.get(category.parentId);
      if (!parent || parent.id === category.id || parent.parentId || parent.type !== category.type) throw new Error('Danh mục cha phải cùng loại và ở cấp đầu tiên.');
    }
    const old = await db.categories.get(category.id);
    if (old && old.type !== category.type) throw new Error('Không thể đổi loại danh mục đã tồn tại.');
    await db.categories.put({ ...category, name: category.name.trim() });
  });
}
export async function debtRemaining(debtId: string) {
  const debt = await db.debts.get(debtId); if (!debt) throw new Error('Khoản nợ không tồn tại.');
  const origin = await db.transactions.get(debt.transactionId); if (!origin || origin.deletedAt) return 0;
  let paid = 0;
  for (const payment of await db.debtPayments.where('debtId').equals(debtId).toArray()) {
    const tx = await db.transactions.get(payment.transactionId); if (tx && !tx.deletedAt) paid += payment.amount;
  }
  return debt.originalAmount - paid;
}
export async function payDebt(debtId: string, amount: number, walletId: string, date = today()) {
  await db.transaction('rw', [db.debts, db.debtPayments, db.transactions, db.wallets, db.categories, db.events], async () => {
    assertMoney(amount); assertDate(date);
    const debt = await db.debts.get(debtId); if (!debt) throw new Error('Không tìm thấy khoản nợ.');
    const origin = await db.transactions.get(debt.transactionId);
    if (origin?.deletedAt || date < debt.date || amount > await debtRemaining(debtId)) throw new Error('Số tiền hoặc ngày thanh toán không hợp lệ.');
    const tx = makeTransaction({ type: 'debt-payment', amount, walletId, date, debtId, paymentDirection: debt.kind === 'lend' ? 'in' : 'out', includeInReports: false, note: `${debt.kind === 'lend' ? 'Thu nợ' : 'Trả nợ'}: ${debt.personName}` });
    await validateTransaction(tx); await db.transactions.add(tx);
    await db.debtPayments.add({ id: id(), debtId, transactionId: tx.id, amount, date });
  });
}
export async function payPersonDebt(kind: 'borrow' | 'lend', personName: string, amount: number, walletId: string, date = today()) {
  await db.transaction('rw', [db.debts, db.debtPayments, db.transactions, db.wallets, db.categories, db.events], async () => {
    assertMoney(amount); assertDate(date);
    const name = normalizePersonName(personName);
    const debts = (await getDebtOverview()).filter(debt => debt.kind === kind && normalizePersonName(debt.personName) === name && debt.remaining > 0 && debt.date <= date);
    const origins = await db.transactions.bulkGet(debts.map(debt => debt.transactionId));
    const originById = new Map(origins.filter(tx => !!tx).map(tx => [tx!.id, tx!]));
    debts.sort((a, b) => {
      const first = originById.get(a.transactionId), second = originById.get(b.transactionId);
      const sameSourceSheet = first?.source === 'heda' && second?.source === 'heda' && first.sourceFile === second.sourceFile && first.sourceSheet === second.sourceSheet;
      return a.date.localeCompare(b.date) || (first?.time ?? '').localeCompare(second?.time ?? '') || (sameSourceSheet ? (second?.sourceRow ?? 0) - (first?.sourceRow ?? 0) : 0) || (first?.createdAt ?? '').localeCompare(second?.createdAt ?? '') || a.id.localeCompare(b.id);
    });
    if (amount > debts.reduce((sum, debt) => sum + debt.remaining, 0)) throw new Error('Số tiền vượt tổng dư nợ có thể thanh toán tại ngày đã chọn.');
    let left = amount;
    for (const debt of debts) {
      const payment = Math.min(left, debt.remaining);
      await payDebt(debt.id, payment, walletId, date);
      left -= payment;
      if (!left) break;
    }
  });
}
export async function getPersonDebtOverview() {
  return groupDebtsByPerson(await getDebtOverview());
}
export interface TransactionFilter { start?: string; end?: string; type?: TransactionType; reportType?: 'income' | 'expense'; walletId?: string; categoryId?: string; eventId?: string; tag?: string; search?: string; trash?: boolean; sort?: 'newest' | 'oldest' | 'largest' }
export async function queryTransactions(filter: TransactionFilter = {}, page = 0, pageSize = 40) {
  const [categories, wallets, events, debts] = await Promise.all([db.categories.toArray(), db.wallets.toArray(), db.events.toArray(), db.debts.toArray()]);
  const names = new Map([...categories, ...wallets, ...events].map(x => [x.id, x.name]));
  const people = new Map(debts.map(d => [d.id, d.personName]));
  const search = filter.search?.trim().toLocaleLowerCase('vi');
  if (filter.start && filter.end && filter.start > filter.end) return { rows: [], hasMore: false };
  let collection = db.transactions.where('[date+time]').between([filter.start ?? '0000-01-01', '00:00'], [filter.end ?? '9999-12-31', '23:59'], true, true);
  if (filter.sort !== 'oldest') collection = collection.reverse();
  collection = collection.filter(tx => !!tx.deletedAt === !!filter.trash && (!filter.type || tx.type === filter.type) && (!filter.reportType || reportAmounts(tx)[filter.reportType] > 0 && !(filter.reportType === 'expense' && filter.walletId && tx.type === 'transfer' && (tx.feeWalletId ?? tx.walletId) !== filter.walletId)) && (!filter.walletId || tx.walletIds.includes(filter.walletId)) && (!filter.categoryId || tx.categoryId === filter.categoryId) && (!filter.eventId || tx.eventId === filter.eventId) && (!filter.tag || tx.tags.includes(filter.tag)) && (!search || [tx.note, String(tx.amount), tx.amount.toLocaleString('vi-VN'), names.get(tx.walletId), names.get(tx.destinationWalletId ?? ''), names.get(tx.categoryId ?? ''), names.get(tx.eventId ?? ''), people.get(tx.debtId ?? ''), ...tx.tags].join(' ').toLocaleLowerCase('vi').includes(search)));
  if (filter.sort === 'largest') {
    // Bounded top-k buffer: even a large history never becomes a full in-memory list.
    const limit = (page + 1) * pageSize + 1; const top: Transaction[] = [];
    await collection.each(tx => { let low = 0, high = top.length; while (low < high) { const mid = (low + high) >>> 1; if (top[mid].amount >= tx.amount) low = mid + 1; else high = mid; } if (low < limit) { top.splice(low, 0, tx); if (top.length > limit) top.pop(); } });
    return { rows: top.slice(page * pageSize, (page + 1) * pageSize), hasMore: top.length > (page + 1) * pageSize };
  }
  const rows = await collection.offset(page * pageSize).limit(pageSize + 1).toArray();
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
export async function aggregate(start: string, end: string, extra: Pick<TransactionFilter, 'walletId' | 'tag' | 'eventId'> = {}) {
  let income = 0, expense = 0, count = 0;
  const expenseCategories: Record<string, number> = {}, incomeCategories: Record<string, number> = {};
  const daily: Record<string, { income: number; expense: number }> = {};
  const top: Transaction[] = [];
  await db.transactions.where('date').between(start, end, true, true).each(tx => {
    if (tx.deletedAt || (extra.walletId && !tx.walletIds.includes(extra.walletId)) || (extra.tag && !tx.tags.includes(extra.tag)) || (extra.eventId && tx.eventId !== extra.eventId)) return;
    count++; const amounts = reportAmounts(tx);
    if (tx.type === 'transfer' && extra.walletId && (tx.feeWalletId ?? tx.walletId) !== extra.walletId) amounts.expense = 0;
    income += amounts.income; expense += amounts.expense;
    const bucket = daily[tx.date] ??= { income: 0, expense: 0 }; bucket.income += amounts.income; bucket.expense += amounts.expense;
    if (amounts.expense) { const key = tx.type === 'transfer' ? 'transfer-fees' : tx.categoryId ?? 'uncategorized'; expenseCategories[key] = (expenseCategories[key] ?? 0) + amounts.expense; }
    if (amounts.income) { const key = tx.categoryId ?? 'uncategorized'; incomeCategories[key] = (incomeCategories[key] ?? 0) + amounts.income; }
    if (tx.type === 'expense' && tx.includeInReports) { top.push(tx); top.sort((a, b) => b.amount - a.amount); if (top.length > 10) top.pop(); }
  });
  return { income, expense, count, expenseCategories, incomeCategories, daily, top };
}
export async function getDebtOverview() {
  const debts = await db.debts.toArray();
  const result = [];
  for (const debt of debts) {
    const tx = await db.transactions.get(debt.transactionId); if (!tx || tx.deletedAt) continue;
    const remaining = await debtRemaining(debt.id);
    result.push({ ...debt, remaining, status: remaining === 0 ? (debt.kind === 'borrow' ? 'Đã trả' : 'Đã thu') : debt.dueDate && debt.dueDate < today() ? 'Quá hạn' : 'Đang mở' });
  }
  return result;
}
export async function generateRecurring(until = today(), ruleId?: string, manual = false) {
  let count = 0;
  const rules = await db.recurring.toArray();
  for (const rule of rules.filter(r => !r.archived && (r.autoCreate || manual) && (!ruleId || r.id === ruleId))) {
    await db.transaction('rw', db.recurring, db.transactions, db.wallets, db.categories, db.events, async () => {
      const current = await db.recurring.get(rule.id); if (!current || current.archived) return;
      let cursor = current.nextRunDate; let generated = 0;
      while (cursor <= until && (!current.endDate || cursor <= current.endDate)) {
        if (++generated > 10000) throw new Error('Lịch quá dài. Thu hẹp ngày bắt đầu để kiểm tra an toàn.');
        const recurringKey = `${current.id}:${cursor}`;
        if (!await db.transactions.where('recurringKey').equals(recurringKey).count()) {
          const tx = makeTransaction({ type: current.type, amount: current.amount, walletId: current.walletId, categoryId: current.categoryId, date: cursor, note: current.note, recurringKey });
          await validateTransaction(tx); await db.transactions.add(tx); count++;
        }
        cursor = nextOccurrence(current, cursor);
      }
      await db.recurring.update(current.id, { nextRunDate: cursor });
    });
  }
  return count;
}
export async function netWorthHistory(start: string, end: string, walletId?: string) {
  const wallets = await db.wallets.toArray();
  const selected = new Set(wallets.filter(w => walletId ? w.id === walletId : w.includeInNetWorth).map(w => w.id));
  let balance = wallets.filter(w => selected.has(w.id)).reduce((s, w) => s + w.openingBalance, 0);
  const changes: Record<string, number> = {};
  await db.transactions.where('date').belowOrEqual(end).each(tx => {
    let delta = 0; for (const [w, amount] of walletEffects(tx)) if (selected.has(w)) delta += amount;
    if (!walletId && !tx.deletedAt) {
      if (tx.type === 'borrow') delta -= tx.amount;
      if (tx.type === 'lend') delta += tx.amount;
      if (tx.type === 'debt-payment') delta += tx.paymentDirection === 'in' ? -tx.amount : tx.amount;
    }
    if (tx.date < start) balance += delta; else changes[tx.date] = (changes[tx.date] ?? 0) + delta;
  });
  const rows = [{ date: start, balance }];
  for (const date of Object.keys(changes).sort()) { balance += changes[date]; rows.push({ date, balance }); }
  if (rows.at(-1)?.date !== end) rows.push({ date: end, balance });
  return rows;
}
export async function seedDemo(size = 90) {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables.filter(t => !['settings', 'categories', 'tags', 'backupMetadata'].includes(t.name))) if (await table.count()) throw new Error('Chỉ thêm dữ liệu mẫu khi chưa có dữ liệu tài chính.');
    const expenseCategories = await db.categories.filter(c => c.type === 'expense' && !c.archived).toArray();
    const incomeCategories = await db.categories.filter(c => c.type === 'income' && !c.archived).toArray();
    if (!expenseCategories.length || !incomeCategories.length) throw new Error('Tạo ít nhất một danh mục thu và một danh mục chi trước khi thêm dữ liệu mẫu.');
    const cash: Wallet = { id: 'demo-cash', name: 'Tiền mặt · mẫu', type: 'cash', icon: '💵', openingBalance: 2500000, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: now() };
    const bank: Wallet = { ...cash, id: 'demo-bank', name: 'Ngân hàng · mẫu', type: 'bank', icon: '🏦', openingBalance: 18000000 };
    await db.wallets.bulkAdd([cash, bank]);
    const batch: Transaction[] = [];
    for (let i = 0; i < size; i++) {
      const date = formatDemoDate(i % 75); const income = i % 18 === 0;
      batch.push(makeTransaction({ id: `demo-tx-${i}`, type: income ? 'income' : 'expense', walletId: i % 3 ? bank.id : cash.id, categoryId: income ? incomeCategories[0].id : expenseCategories[i % expenseCategories.length].id, amount: income ? 18000000 : 25000 + (i % 13) * 35000, date, note: income ? 'Lương · dữ liệu mẫu' : ['Cà phê sáng', 'Mua đồ dùng', 'Ăn trưa', 'Đi lại', 'Sách mới'][i % 5] + ' · mẫu', source: 'demo' }));
    }
    await db.transactions.bulkAdd(batch);
    await db.budgets.add({ id: 'demo-budget', month: today().slice(0, 7), name: 'Ngân sách tháng · mẫu', amount: 10000000 });
    await db.settings.update('app', { defaultWalletId: bank.id });
  });
}
function formatDemoDate(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

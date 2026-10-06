import { useEffect, useState } from 'react';
import { ChevronDown, Equal, Plus } from 'lucide-react';
import { db } from './db';
import { calculateExpression, today, money } from './finance';
import { saveTransaction, adjustBalance } from './services';
import { transactionLabels, type Transaction, type TransactionType } from './types';
import { Modal, Field, useApp, useSubmit, SubmitButton, CategorySelect, WalletSelect, EmptyState } from './ui';
import { useLiveQuery } from 'dexie-react-hooks';

export function QuickMenu({ onClose }: { onClose: () => void }) {
  const { openTransaction } = useApp();
  return <Modal title="Ghi chép mới" onClose={onClose}><p className="muted">Một chút rõ ràng cho mỗi ngày.</p><div className="quick-menu">{(['expense', 'income', 'transfer', 'borrow', 'lend', 'adjustment'] as TransactionType[]).map((type, i) => <button key={type} aria-label={transactionLabels[type]} onClick={() => { onClose(); openTransaction(type); }}><span>{['↗', '↙', '⇄', '↓', '↑', '±'][i]}</span>{transactionLabels[type]}<Plus size={17} /></button>)}</div></Modal>;
}
export function TransactionForm({ type, transaction, initialWalletId, onClose }: { type: TransactionType; transaction?: Transaction; initialWalletId?: string; onClose: () => void }) {
  const { metadata, navigate } = useApp();
  const existingDebt = useLiveQuery(() => transaction?.debtId ? db.debts.get(transaction.debtId) : undefined, [transaction?.debtId]);
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [categoryId, setCategory] = useState(transaction?.categoryId ?? (metadata.categories.find(c => c.id === metadata.settings.lastCategoryId && c.type === type)?.id ?? ''));
  const [walletId, setWallet] = useState(transaction?.walletId ?? initialWalletId ?? metadata.wallets.find(w => w.id === metadata.settings.defaultWalletId && !w.archived)?.id ?? metadata.wallets.find(w => !w.archived)?.id ?? '');
  const [destinationWalletId, setDestination] = useState(transaction?.destinationWalletId ?? '');
  const [fee, setFee] = useState(String(transaction?.transferFee ?? 0));
  const [feeWalletId, setFeeWallet] = useState(transaction?.feeWalletId ?? '');
  const [date, setDate] = useState(transaction?.date ?? today()); const [time, setTime] = useState(transaction?.time ?? new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState(transaction?.note ?? ''); const [tags, setTags] = useState(transaction?.tags.join(', ') ?? '');
  const [eventId, setEvent] = useState(transaction?.eventId ?? ''); const [includeInReports, setInclude] = useState(transaction?.includeInReports ?? true);
  const [personName, setPerson] = useState(''); const [dueDate, setDue] = useState(''); const [details, setDetails] = useState(!!transaction);
  useEffect(() => { if (existingDebt) { setPerson(existingDebt.personName); setDue(existingDebt.dueDate ?? ''); } }, [existingDebt?.id]);
  let result: number | undefined; try { if (amount) result = calculateExpression(amount); } catch { /* Incomplete expressions remain editable. */ }
  const { submit, busy } = useSubmit(async () => {
    const value = calculateExpression(amount);
    if (type === 'adjustment') { await adjustBalance(walletId, value, date); return; }
    await saveTransaction({ ...(transaction ?? {}), type, amount: value, walletId, categoryId: ['expense', 'income'].includes(type) ? categoryId : undefined,
      destinationWalletId: type === 'transfer' ? destinationWalletId : undefined, transferFee: type === 'transfer' ? calculateExpression(fee) : 0, feeWalletId: type === 'transfer' ? feeWalletId || walletId : undefined,
      date, time, note, tags: tags.split(/[,#]/).map(t => t.trim()).filter(Boolean), eventId: eventId || undefined, includeInReports,
      personName, dueDate: dueDate || undefined,
    });
  }, transaction ? 'Đã cập nhật giao dịch' : 'Đã lưu giao dịch', onClose);
  if (!metadata.wallets.some(w => !w.archived)) return <Modal title={transactionLabels[type]} onClose={onClose}><EmptyState title="Tạo ví đầu tiên của bạn" description="Ví là nơi lưu tiền mặt, tài khoản ngân hàng hoặc tài sản." actionLabel="Tạo ví" action={() => { onClose(); navigate('wallets'); }} /></Modal>;
  return <Modal title={`${transaction ? 'Sửa' : 'Thêm'} ${transactionLabels[type].toLowerCase()}`} onClose={onClose}><form onSubmit={submit}>
    <label className="amount-field"><span>{type === 'adjustment' ? 'Số dư thực tế hiện tại' : 'Số tiền'} <small>VND</small></span><input autoFocus inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" aria-label="Số tiền" required autoComplete="off" /><span className="expression-preview"><Equal size={14} />{result !== undefined ? money(result) : 'Có thể nhập 120000 + 35000'}</span></label>
    <div className="calculator-tools" aria-label="Phép tính nhanh">{[['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['(', '('], [')', ')']].map(([operator, label]) => <button key={operator} type="button" aria-label={`Thêm dấu ${label}`} onClick={() => setAmount(value => `${value}${operator}`)}>{label}</button>)}<button type="button" onClick={() => { if (result !== undefined) setAmount(String(result)); }} disabled={result === undefined} aria-label="Tính kết quả">=</button></div>
    {(type === 'income' || type === 'expense') && <><Field label="Danh mục"><CategorySelect type={type} value={categoryId} onChange={setCategory} /></Field><div className="category-chips">{metadata.categories.filter(c => c.type === type && !c.archived).slice(0, 8).map(c => <button className={categoryId === c.id ? 'selected' : ''} type="button" onClick={() => setCategory(c.id)} key={c.id}>{c.icon} {c.name}</button>)}</div><button className="text-link" type="button" onClick={() => { onClose(); navigate('categories'); }}>Quản lý / tạo danh mục</button></>}
    <Field label={type === 'transfer' ? 'Ví gửi' : 'Ví'}><WalletSelect value={walletId} onChange={setWallet} allowArchived={!!transaction} /></Field>
    {type === 'transfer' && <><Field label="Ví nhận"><WalletSelect value={destinationWalletId} onChange={setDestination} /></Field><div className="form-grid"><Field label="Phí chuyển khoản"><input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value)} required /></Field><Field label="Ví trả phí"><WalletSelect value={feeWalletId || walletId} onChange={setFeeWallet} /></Field></div></>}
    {(type === 'borrow' || type === 'lend') && <><Field label={type === 'borrow' ? 'Người cho vay' : 'Người vay'}><input value={personName} onChange={e => setPerson(e.target.value)} required /></Field><Field label="Hạn trả (không bắt buộc)"><input type="date" value={dueDate} onChange={e => setDue(e.target.value)} /></Field></>}
    {type === 'adjustment' && <p className="notice">App sẽ ghi một bút toán bằng chênh lệch giữa số dư thực tế và số dư sổ sách. Lịch sử giao dịch được giữ nguyên.</p>}
    <button type="button" className="details-toggle" onClick={() => setDetails(!details)}>Thêm chi tiết <ChevronDown size={18} className={details ? 'rotate' : ''} /></button>
    {details && <div className="extra-fields"><div className="form-grid"><Field label="Ngày"><input type="date" required value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Giờ"><input type="time" required value={time} onChange={e => setTime(e.target.value)} /></Field></div><Field label="Ghi chú"><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Khoản này dành cho…" /></Field><Field label="Tags" hint="Phân cách bằng dấu phẩy; ví dụ: work, travel"><input value={tags} onChange={e => setTags(e.target.value)} list="tag-suggestions" /><datalist id="tag-suggestions">{metadata.tags.map(t => <option key={t.id} value={t.name} />)}</datalist></Field><Field label="Sự kiện"><select value={eventId} onChange={e => setEvent(e.target.value)}><option value="">Không có sự kiện</option>{metadata.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><label className="check-field"><input type="checkbox" checked={includeInReports} onChange={e => setInclude(e.target.checked)} />Tính trong báo cáo thu / chi</label></div>}
    <SubmitButton busy={busy} label={transaction ? 'Lưu thay đổi' : 'Lưu giao dịch'} />
  </form></Modal>;
}

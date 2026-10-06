import { Children, cloneElement, isValidElement, createContext, useContext, useEffect, useRef, useState, useId, type ReactNode, type ReactElement, type FormEvent } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Plus, ChevronLeft, ChevronRight, Wallet as WalletIcon, Leaf, Copy, Trash2, Pencil, MoreHorizontal } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, addMonths, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { db, defaultSettings } from './db';
import { currentMonth, money } from './finance';
import { duplicateTransaction, trashTransaction, type TransactionFilter } from './services';
import { transactionLabels, type Transaction, type TransactionType } from './types';

export const useMetadata = () => useLiveQuery(async () => ({ wallets: await db.wallets.toArray(), categories: await db.categories.orderBy('sortOrder').toArray(), events: await db.events.toArray(), tags: await db.tags.toArray(), settings: await db.settings.get('app') ?? defaultSettings }), [], { wallets: [], categories: [], events: [], tags: [], settings: defaultSettings });
export type Metadata = ReturnType<typeof useMetadata>;
export interface AppContextValue {
  metadata: Metadata; month: string; setMonth: (month: string) => void;
  notify: (message: string, error?: boolean) => void;
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
  openTransaction: (type?: TransactionType, transaction?: Transaction, initialWalletId?: string) => void;
  navigate: (route: string, filter?: TransactionFilter) => void;
  filter: TransactionFilter;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
export function EmptyState({ title = 'Chưa có giao dịch nào', description = 'Một ghi chép nhỏ hôm nay, một bức tranh rõ hơn ngày mai.', action, actionLabel = 'Thêm giao dịch', icon }: { title?: string; description?: string; action?: () => void; actionLabel?: string; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon ?? <Leaf size={30} />}</div><h3>{title}</h3><p>{description}</p>{action && <button className="button primary" onClick={action}><Plus size={17} />{actionLabel}</button>}</div>;
}
export function Money({ value, className = '' }: { value: number; className?: string }) { const { metadata } = useApp(); return <span className={`money ${className}`}>{money(value, metadata.settings.numberFormat, metadata.settings.currency)}</span>; }
export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function MonthSelector() {
  const { month, setMonth } = useApp();
  const move = (n: number) => setMonth(format(addMonths(parseISO(`${month}-01`), n), 'yyyy-MM'));
  return <div className="month-selector"><button className="icon-button" aria-label="Tháng trước" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="month-label" onClick={() => setMonth(currentMonth())} title="Về tháng hiện tại">Tháng {Number(month.slice(5))}, {month.slice(0, 4)}</button><button className="icon-button" aria-label="Tháng sau" onClick={() => move(1)}><ChevronRight size={18} /></button></div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`sheet ${wide ? 'wide' : ''}`} aria-labelledby={titleId} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><div className="sheet-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Đóng" type="button" onClick={onClose}><X size={22} /></button></div><div className="sheet-body">{children}</div></dialog>;
}
const FieldLabelContext = createContext<string | undefined>(undefined);
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const labelId = useId();
  return <FieldLabelContext.Provider value={labelId}><div className="field"><label className="field-label"><span id={labelId}>{label}</span>{Children.map(children, child => isValidElement(child) && typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type) ? cloneElement(child as ReactElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>, { 'aria-labelledby': labelId, 'aria-describedby': hint ? `${labelId}-hint` : undefined }) : child)}</label>{hint && <small id={`${labelId}-hint`}>{hint}</small>}</div></FieldLabelContext.Provider>;
}
export function SubmitButton({ busy, label = 'Lưu', danger = false }: { busy: boolean; label?: string; danger?: boolean }) { return <button className={`button ${danger ? 'danger' : 'primary'} submit-button`} disabled={busy} type="submit">{busy ? 'Đang xử lý…' : label}</button>; }
export function useSubmit(action: () => Promise<unknown>, success: string, done?: () => void) {
  const [busy, setBusy] = useState(false); const { run } = useApp(); const lock = useRef(false);
  return { busy, submit: async (e: FormEvent) => { e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); try { if (await run(action, success)) done?.(); } finally { lock.current = false; setBusy(false); } } };
}
export function Confirm({ title, message, action, onClose, strong = false }: { title: string; message: string; action: () => Promise<unknown>; onClose: () => void; strong?: boolean }) {
  const [confirmation, setConfirmation] = useState('');
  const { submit, busy } = useSubmit(async () => { if (strong && confirmation !== 'XÓA TẤT CẢ') throw new Error('Nhập chính xác XÓA TẤT CẢ.'); await action(); }, 'Đã hoàn tất', onClose);
  return <Modal title={title} onClose={onClose}><form onSubmit={submit}><p className="body-copy">{message}</p>{strong && <Field label="Nhập XÓA TẤT CẢ để xác nhận"><input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></Field>}<div className="form-actions"><button className="button secondary" type="button" onClick={onClose}>Hủy</button><SubmitButton busy={busy} danger label="Xác nhận" /></div></form></Modal>;
}
export function TransactionRow({ transaction: tx }: { transaction: Transaction }) {
  const { metadata, openTransaction, run } = useApp(); const [actions, setActions] = useState(false); const [confirm, setConfirm] = useState(false);
  const sourceRows = useLiveQuery(() => actions ? db.hedaSourceRows.where('transactionIds').equals(tx.id).toArray() : [], [actions, tx.id], []);
  const category = metadata.categories.find(c => c.id === tx.categoryId); const wallet = metadata.wallets.find(w => w.id === tx.walletId);
  const incoming = ['income', 'borrow'].includes(tx.type) || tx.type === 'debt-payment' && tx.paymentDirection === 'in' || tx.type === 'adjustment' && tx.amount >= 0;
  const neutral = tx.type === 'transfer' || tx.type === 'adjustment';
  const edit = () => { setActions(false); openTransaction(tx.type, tx); };
  return <><div className="transaction-row"><button className="transaction-main" onClick={() => setActions(true)}><span className="category-icon" style={{ background: `${category?.color ?? '#86a898'}20` }}>{category?.icon ?? (neutral ? <ArrowLeftRight size={20} /> : incoming ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />)}</span><span className="transaction-text"><strong>{tx.note || category?.name || transactionLabels[tx.type]}</strong><small>{category?.name ?? transactionLabels[tx.type]}<span>·</span>{wallet?.name ?? 'Ví'}<span>·</span>{format(parseISO(tx.date), metadata.settings.dateFormat, { locale: vi })}</small></span><span className={`transaction-amount ${incoming ? 'positive' : ''}`}><Money value={neutral ? tx.amount : incoming ? tx.amount : -tx.amount} /><small>{tx.time}</small></span></button><button className="icon-button transaction-more" aria-label="Tùy chọn giao dịch" onClick={() => setActions(true)}><MoreHorizontal size={18} /></button></div>
    {actions && <Modal title="Chi tiết giao dịch" onClose={() => setActions(false)}><div className="detail-amount"><span>{transactionLabels[tx.type]}</span><Money value={tx.amount} /></div><dl className="details"><dt>Ngày</dt><dd>{tx.date} · {tx.time}</dd><dt>Ví</dt><dd>{wallet?.name}</dd>{tx.destinationWalletId && <><dt>Ví nhận</dt><dd>{metadata.wallets.find(w => w.id === tx.destinationWalletId)?.name}</dd><dt>Phí</dt><dd><Money value={tx.transferFee} /></dd></>}<dt>Danh mục</dt><dd>{category?.name ?? '—'}</dd><dt>Ghi chú</dt><dd>{tx.note || '—'}</dd><dt>Tags</dt><dd>{tx.tags.map(t => `#${t}`).join(' ') || '—'}</dd><dt>Sự kiện</dt><dd>{metadata.events.find(e => e.id === tx.eventId)?.name ?? '—'}</dd><dt>Báo cáo</dt><dd>{tx.includeInReports ? 'Có tính' : 'Không tính'}</dd></dl>{sourceRows.length > 0 && <details className="source-details"><summary>Dòng nguồn HeDa ({sourceRows.length})</summary>{sourceRows.map(row => <div key={row.id}><p>{row.fileName} · {row.sheet} · dòng {row.row}</p><p>{row.originalType} · {row.category}{row.subcategory ? ` / ${row.subcategory}` : ''} · {row.originalTime}</p><p>{row.walletName}: <Money value={row.amount} /> · Số dư sau: <Money value={row.balanceAfter} /></p><p>{row.note || 'Không ghi chú'}</p></div>)}</details>}<div className="action-list">{tx.type !== 'debt-payment' && tx.type !== 'adjustment' && <button onClick={edit}><Pencil size={18} />Chỉnh sửa</button>}{!['borrow', 'lend', 'debt-payment', 'adjustment'].includes(tx.type) && <button onClick={async () => { if (await run(() => duplicateTransaction(tx), 'Đã nhân bản giao dịch')) setActions(false); }}><Copy size={18} />Nhân bản hôm nay</button>}<button className="danger-text" onClick={() => { setActions(false); setConfirm(true); }}><Trash2 size={18} />Chuyển vào thùng rác</button></div></Modal>}
    {confirm && <Confirm title="Chuyển vào thùng rác?" message="Giao dịch sẽ được loại khỏi số dư và báo cáo. Bạn có thể khôi phục trong mục Thùng rác." action={() => trashTransaction(tx.id)} onClose={() => setConfirm(false)} />}
  </>;
}
export function WalletSelect({ value, onChange, allowArchived = false }: { value: string; onChange: (value: string) => void; allowArchived?: boolean }) { const { metadata } = useApp(); const labelId = useContext(FieldLabelContext); return <select aria-labelledby={labelId} value={value} required onChange={e => onChange(e.target.value)}><option value="">Chọn ví</option>{metadata.wallets.filter(w => allowArchived || !w.archived || w.id === value).map(w => <option value={w.id} key={w.id}>{w.icon} {w.name}</option>)}</select>; }
export function CategorySelect({ type, value, onChange, optional = false }: { type: 'income' | 'expense'; value: string; onChange: (value: string) => void; optional?: boolean }) { const { metadata } = useApp(); const labelId = useContext(FieldLabelContext); return <select aria-labelledby={labelId} value={value} required={!optional} onChange={e => onChange(e.target.value)}><option value="">{optional ? 'Tất cả danh mục' : 'Chọn danh mục'}</option>{metadata.categories.filter(c => c.type === type && (!c.archived || c.id === value)).map(c => <option value={c.id} key={c.id}>{c.parentId ? '↳ ' : ''}{c.icon} {c.name}</option>)}</select>; }
export function Loading() { return <div className="skeleton-grid" aria-label="Đang tải dữ liệu"><div /><div /><div /></div>; }
export function WalletGlyph() { return <WalletIcon size={20} />; }

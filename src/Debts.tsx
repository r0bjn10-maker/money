import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { db } from './db';
import { getPersonDebtOverview, payPersonDebt } from './services';
import { today, calculateExpression } from './finance';
import type { PersonDebtGroup } from './debt-groups';
import { useApp, PageTitle, Money, Modal, Field, SubmitButton, WalletSelect, useSubmit, EmptyState, TransactionRow } from './ui';

export function Debts() {
  const { openTransaction } = useApp();
  const [kind, setKind] = useState<'borrow' | 'lend'>('borrow');
  const [selectedKey, setSelectedKey] = useState<string>();
  const groups = useLiveQuery(getPersonDebtOverview, [], []);
  const rows = groups.filter(group => group.kind === kind);
  const selected = groups.find(group => group.key === selectedKey);
  return <>
    <PageTitle eyebrow="MỖI NGƯỜI, MỘT GHI CHÉP" title="Vay & cho vay" description="Các khoản cùng tên được cộng chung; lịch sử từng khoản luôn được giữ đầy đủ." action={<button className="button primary" onClick={() => openTransaction(kind)}><Plus size={18} />{kind === 'borrow' ? 'Thêm khoản vay' : 'Thêm khoản cho vay'}</button>} />
    <div className="list-toolbar"><div className="segmented"><button className={kind === 'borrow' ? 'active' : ''} onClick={() => setKind('borrow')}>Tôi nợ</button><button className={kind === 'lend' ? 'active' : ''} onClick={() => setKind('lend')}>Người khác nợ tôi</button></div><Money value={rows.reduce((sum, group) => sum + group.remaining, 0)} /></div>
    <div className="debt-grid">{rows.length ? rows.map(group => <button className="panel debt-card" key={group.key} onClick={() => setSelectedKey(group.key)}>
      <div className="debt-card-top"><span className="person-avatar">{group.personName.slice(0, 1).toUpperCase()}</span><span className={`soft-badge ${group.status === 'Quá hạn' ? 'danger-text' : ''}`}>{group.status}</span></div>
      <h2>{group.personName}</h2><span className="muted">Còn lại</span><Money value={group.remaining} /><small>Tổng gốc <Money value={group.originalAmount} /> · {group.debts.length} khoản{group.dueDate && ` · Hạn ${group.dueDate}`}</small>
      <div className="progress"><span style={{ width: `${(1 - group.remaining / group.originalAmount) * 100}%` }} /></div>
    </button>) : <section className="panel full-width"><EmptyState title="Mọi khoản nợ đều rõ ràng" description="Ghi lại khoản vay hoặc cho vay và theo dõi mỗi lần thanh toán." action={() => openTransaction(kind)} actionLabel="Ghi khoản nợ" /></section>}</div>
    {selected && <PersonDebtDetail key={selected.key} group={selected} onClose={() => setSelectedKey(undefined)} />}
  </>;
}

function PersonDebtDetail({ group, onClose }: { group: PersonDebtGroup; onClose: () => void }) {
  const { metadata } = useApp();
  const [amount, setAmount] = useState('');
  const defaultWallet = metadata.wallets.find(wallet => wallet.id === metadata.settings.defaultWalletId && !wallet.archived) ?? metadata.wallets.find(wallet => wallet.id === group.debts[0]?.walletId && !wallet.archived) ?? metadata.wallets.find(wallet => !wallet.archived);
  const [walletId, setWallet] = useState(defaultWallet?.id ?? '');
  const [date, setDate] = useState(today());
  const [historyPage, setHistoryPage] = useState(0);
  const [loanPage, setLoanPage] = useState(0);
  const debtIds = group.debts.map(debt => debt.id);
  const history = useLiveQuery(async () => {
    const payments = await db.debtPayments.where('debtId').anyOf(debtIds).toArray();
    const transactions = (await db.transactions.bulkGet(payments.map(payment => payment.transactionId))).filter(tx => !!tx && !tx.deletedAt);
    return transactions.sort((a, b) => `${b!.date} ${b!.time}`.localeCompare(`${a!.date} ${a!.time}`));
  }, [JSON.stringify(debtIds)], []);
  const { submit, busy } = useSubmit(async () => {
    await payPersonDebt(group.kind, group.personName, calculateExpression(amount), walletId, date);
    setAmount(''); setHistoryPage(0);
  }, 'Đã ghi nhận thanh toán');
  return <Modal title={group.personName} onClose={onClose}>
    <div className="detail-amount"><span>{group.kind === 'borrow' ? 'Tổng bạn còn nợ' : 'Tổng còn nợ bạn'}</span><Money value={group.remaining} /></div>
    <p className="muted">Tổng gốc <Money value={group.originalAmount} /> · {group.debts.length} khoản · Từ {group.date}</p>
    {group.remaining > 0 && <form onSubmit={submit}>
      <Field label={group.kind === 'borrow' ? 'Số tiền trả · VND' : 'Số tiền thu · VND'}><input inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required /></Field>
      <button className="text-link" type="button" onClick={() => setAmount(String(group.remaining))}>Thanh toán toàn bộ</button>
      <div className="form-grid"><Field label="Ví"><WalletSelect value={walletId} onChange={setWallet} /></Field><Field label="Ngày"><input type="date" value={date} onChange={event => setDate(event.target.value)} min={group.date} required /></Field></div>
      {group.debts.length > 1 && <p className="footnote">Thanh toán vào các khoản còn mở từ cũ đến mới (FIFO). Mỗi phần có bút toán ví và lịch sử tương ứng.</p>}
      <SubmitButton busy={busy} label={group.kind === 'borrow' ? 'Ghi nhận trả nợ' : 'Ghi nhận thu nợ'} />
    </form>}
    <details className="source-details loan-breakdown"><summary>Các khoản gốc ({group.debts.length})</summary>{group.debts.slice(loanPage * 10, loanPage * 10 + 10).map(debt => <div key={debt.id}><strong>{debt.date} · {debt.status}</strong><p>Gốc <Money value={debt.originalAmount} /> · Còn <Money value={debt.remaining} /></p><p>{metadata.wallets.find(wallet => wallet.id === debt.walletId)?.name}{debt.dueDate && ` · Hạn ${debt.dueDate}`}</p>{debt.note && <p>{debt.note}</p>}</div>)}{group.debts.length > 10 && <div className="pagination"><button className="button secondary" disabled={!loanPage} onClick={() => setLoanPage(page => page - 1)}>Trước</button><span>{loanPage + 1} / {Math.ceil(group.debts.length / 10)}</span><button className="button secondary" disabled={(loanPage + 1) * 10 >= group.debts.length} onClick={() => setLoanPage(page => page + 1)}>Sau</button></div>}</details>
    <h3 className="section-subtitle">Lịch sử thanh toán</h3>{history.length ? history.slice(historyPage * 20, historyPage * 20 + 20).map(tx => tx && <TransactionRow key={tx.id} transaction={tx} />) : <p className="muted">Chưa có thanh toán.</p>}
    {history.length > 20 && <div className="pagination"><button className="button secondary" disabled={!historyPage} onClick={() => setHistoryPage(page => page - 1)}>Trước</button><span>{historyPage + 1} / {Math.ceil(history.length / 20)}</span><button className="button secondary" disabled={(historyPage + 1) * 20 >= history.length} onClick={() => setHistoryPage(page => page + 1)}>Sau</button></div>}
  </Modal>;
}

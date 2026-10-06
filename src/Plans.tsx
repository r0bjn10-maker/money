import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addMonths, format, parseISO } from 'date-fns';
import { Plus, Copy, Trash2, Target } from 'lucide-react';
import { db } from './db';
import { aggregate } from './services';
import { assertMoney, calculateExpression, id, monthRange } from './finance';
import type { Budget } from './types';
import { useApp, PageTitle, MonthSelector, Money, EmptyState, Modal, Field, CategorySelect, SubmitButton, useSubmit, Confirm } from './ui';

export function Plans() {
  const { metadata, month, navigate, run } = useApp(); const [edit, setEdit] = useState<Budget | 'new'>(); const [remove, setRemove] = useState<Budget>();
  const data = useLiveQuery(async () => ({ budgets: await db.budgets.where('month').equals(month).toArray(), summary: await aggregate(...monthRange(month)) }), [month]);
  const copy = async () => {
    await db.transaction('rw', db.budgets, async () => {
      const previousMonth = format(addMonths(parseISO(`${month}-01`), -1), 'yyyy-MM'); const previous = await db.budgets.where('month').equals(previousMonth).toArray(); if (!previous.length) throw new Error('Tháng trước chưa có ngân sách.');
      const existing = await db.budgets.where('month').equals(month).toArray(); const newRows = previous.filter(b => !existing.some(e => e.name === b.name && e.categoryId === b.categoryId)).map(b => ({ ...b, id: id(), month }));
      if (!newRows.length) throw new Error('Ngân sách đã được sao chép.'); await db.budgets.bulkAdd(newRows);
    });
  };
  return <><PageTitle eyebrow="DÀNH CHỖ CHO ĐIỀU QUAN TRỌNG" title="Kế hoạch chi tiêu" description="Một giới hạn vừa đủ, để chi tiêu an tâm hơn." action={<MonthSelector />} /><div className="list-toolbar"><button className="button secondary" onClick={() => void run(copy, 'Đã sao chép ngân sách tháng trước')}><Copy size={17} />Sao chép tháng trước</button><button className="button primary" onClick={() => setEdit('new')}><Plus size={18} />Tạo ngân sách</button></div>
    {data?.budgets.length ? <div className="budget-grid">{data.budgets.map(b => {
      const category = metadata.categories.find(c => c.id === b.categoryId); const spent = b.categoryId ? data.summary.expenseCategories[b.categoryId] ?? 0 : data.summary.expense; const ratio = spent / b.amount; const status = ratio >= 1 ? 'Đã vượt ngân sách' : ratio >= 0.8 ? 'Gần giới hạn' : 'Trong kế hoạch';
      return <section className={`panel budget-card ${ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'near-limit' : ''}`} key={b.id}><button className="budget-card-title" onClick={() => setEdit(b)}><span className="category-icon">{category?.icon ?? <Target size={22} />}</span><span><h2>{b.name}</h2><small>{category?.name ?? 'Toàn bộ chi tiêu'}</small></span><span>↗</span></button><div className="budget-amounts"><Money value={spent} /><span>/ <Money value={b.amount} /></span></div><div className="progress"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div><div className="budget-status"><span>{Math.round(ratio * 100)}% · {status}</span><button className="icon-button" aria-label="Xóa ngân sách" onClick={() => setRemove(b)}><Trash2 size={16} /></button></div><button className="text-link" onClick={() => navigate('transactions', { start: monthRange(month)[0], end: monthRange(month)[1], reportType: 'expense', categoryId: b.categoryId })}>Xem giao dịch</button></section>;
    })}</div> : <section className="panel"><EmptyState icon={<Target size={30} />} title="Tháng này, bạn dự định chi bao nhiêu?" description="Tạo ngân sách tổng hoặc theo từng danh mục. Tháng cũ luôn được giữ lại." actionLabel="Tạo ngân sách" action={() => setEdit('new')} /></section>}
    {edit && <BudgetForm budget={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} />}{remove && <Confirm title="Xóa ngân sách?" message="Lịch sử giao dịch không thay đổi." action={() => db.budgets.delete(remove.id)} onClose={() => setRemove(undefined)} />}
  </>;
}
function BudgetForm({ budget, onClose }: { budget?: Budget; onClose: () => void }) {
  const { month } = useApp(); const [name, setName] = useState(budget?.name ?? 'Ngân sách tháng'); const [amount, setAmount] = useState(budget ? String(budget.amount) : ''); const [categoryId, setCategory] = useState(budget?.categoryId ?? ''); const [budgetMonth, setMonth] = useState(budget?.month ?? month);
  const { submit, busy } = useSubmit(async () => { if (!name.trim()) throw new Error('Nhập tên ngân sách.'); const value = calculateExpression(amount); assertMoney(value); await db.budgets.put({ id: budget?.id ?? id(), month: budgetMonth, name: name.trim(), amount: value, categoryId: categoryId || undefined }); }, 'Đã lưu ngân sách', onClose);
  return <Modal title={budget ? 'Sửa ngân sách' : 'Ngân sách mới'} onClose={onClose}><form onSubmit={submit}><Field label="Tên ngân sách"><input value={name} onChange={e => setName(e.target.value)} required /></Field><Field label="Tháng"><input type="month" value={budgetMonth} onChange={e => setMonth(e.target.value)} required /></Field><Field label="Giới hạn chi · VND"><input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} required /></Field><Field label="Danh mục"><CategorySelect type="expense" value={categoryId} onChange={setCategory} optional /></Field><SubmitButton busy={busy} label="Lưu ngân sách" /></form></Modal>;
}

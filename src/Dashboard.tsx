import { useLiveQuery } from 'dexie-react-hooks';
import { format, addMonths, parseISO, eachDayOfInterval } from 'date-fns';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ShieldCheck, Wallet, Plus, ArrowRight, CalendarDays } from 'lucide-react';
import { db } from './db';
import { aggregate, getBalances, getDebtOverview, queryTransactions } from './services';
import { monthRange, money } from './finance';
import { useApp, PageTitle, MonthSelector, Money, TransactionRow, EmptyState, Loading } from './ui';

export function Dashboard() {
  const { metadata, month, navigate, openTransaction } = useApp();
  const data = useLiveQuery(async () => {
    const [start, end] = monthRange(month);
    const previousMonth = format(addMonths(parseISO(`${month}-01`), -1), 'yyyy-MM');
    const [summary, previous, balances, debts, recent, budgets] = await Promise.all([aggregate(start, end), aggregate(...monthRange(previousMonth)), getBalances(), getDebtOverview(), queryTransactions({ start, end }, 0, 5), db.budgets.where('month').equals(month).toArray()]);
    return { summary, previous, balances, debts, recent, budgets };
  }, [month]);
  if (!data) return <><PageTitle eyebrow="SỔ TÀI CHÍNH CÁ NHÂN" title="Tổng quan tài chính" /><Loading /></>;
  const totalAssets = metadata.wallets.filter(w => w.includeInNetWorth).reduce((sum, w) => sum + (data.balances[w.id] ?? 0), 0);
  const cash = metadata.wallets.filter(w => w.type === 'cash' && w.includeInNetWorth).reduce((sum, w) => sum + (data.balances[w.id] ?? 0), 0);
  const receivable = data.debts.filter(d => d.kind === 'lend').reduce((sum, d) => sum + d.remaining, 0);
  const payable = data.debts.filter(d => d.kind === 'borrow').reduce((sum, d) => sum + d.remaining, 0);
  const budgetLimit = data.budgets.filter(b => !b.categoryId).reduce((sum, b) => sum + b.amount, 0);
  const categoryData = Object.entries(data.summary.expenseCategories).sort((a, b) => b[1] - a[1]).map(([key, value]) => {
    const category = metadata.categories.find(c => c.id === key);
    return { id: key, name: category?.name ?? 'Phí chuyển khoản', value, color: category?.color ?? '#a4a18f' };
  });
  const dailyData = eachDayOfInterval({ start: parseISO(`${month}-01`), end: parseISO(monthRange(month)[1]) }).map(day => ({ date: format(day, 'dd'), expense: data.summary.daily[format(day, 'yyyy-MM-dd')]?.expense ?? 0 }));
  const delta = data.previous.expense ? (data.summary.expense - data.previous.expense) / data.previous.expense * 100 : undefined;
  const openMonth = (type?: 'income' | 'expense') => navigate('transactions', { start: monthRange(month)[0], end: monthRange(month)[1], reportType: type });
  function openCategory(categoryId: string) { navigate('transactions', { start: monthRange(month)[0], end: monthRange(month)[1], ...(categoryId === 'transfer-fees' ? { type: 'transfer' } : { type: 'expense', reportType: 'expense', categoryId }) }); }
  return <>
    <PageTitle className="dashboard-heading" eyebrow={`TỔNG QUAN / ${format(new Date(), 'dd.MM.yyyy')}`} title="Tổng quan tài chính" description="Nhìn rõ tiền của bạn, mỗi ngày." />
    <section className="wealth-hero" aria-label="Tổng quan tài sản">
      <div className="wealth-main"><div className="wealth-kicker"><span>TỔNG TÀI SẢN</span><span><ShieldCheck size={14} /> Chỉ trên thiết bị của bạn</span></div><button className="asset-value" onClick={() => navigate('wallets')}><Money value={totalAssets} /><ArrowUpRight size={30} /></button><div className="wealth-baseline"><span>Số dư hiện tại · {metadata.wallets.filter(w => !w.archived).length} ví đang sử dụng</span><button onClick={() => navigate('wallets')}>Xem các ví <ArrowRight size={16} /></button></div></div>
      <div className="wealth-composition"><span className="composition-label">TÀI SẢN CẤU THÀNH</span><button onClick={() => navigate('wallets')}><span>Tiền mặt</span><Money value={cash} /></button><button onClick={() => navigate('wallets')}><span>Tài khoản & tài sản khác</span><Money value={totalAssets - cash} /></button><button onClick={() => navigate('statistics')}><span>Tài sản ròng</span><Money value={totalAssets + receivable - payable} /></button></div>
    </section>
    <nav className="dashboard-actions" aria-label="Ghi chép nhanh"><button onClick={() => openTransaction('expense')}><Plus size={18} /><span>Ghi khoản chi</span><ArrowUpRight size={17} /></button><button onClick={() => openTransaction('income')}><ArrowDownLeft size={18} /><span>Thêm thu nhập</span><ArrowUpRight size={17} /></button><button onClick={() => openTransaction('transfer')}><ArrowLeftRight size={18} /><span>Chuyển tiền</span><ArrowUpRight size={17} /></button><button onClick={() => navigate('wallets')}><Wallet size={18} /><span>Ví & tài sản</span><ArrowUpRight size={17} /></button></nav>
    <div className="editorial-section-head"><div><span className="section-index">01</span><h2>Dòng tiền tháng này</h2></div><MonthSelector /></div>
    <div className="flow-strip">
      <button className="metric-card" onClick={() => openMonth('income')}><span className="metric-label"><ArrowDownLeft size={17} />Thu nhập tháng</span><Money value={data.summary.income} /><span className="metric-footer">Tiền vào trong kỳ <ArrowUpRight size={16} /></span></button>
      <button className="metric-card" onClick={() => openMonth('expense')}><span className="metric-label"><ArrowUpRight size={17} />Chi tiêu tháng</span><Money value={data.summary.expense} /><span className={`metric-footer ${delta !== undefined && delta > 0 ? 'negative' : ''}`}>{delta === undefined ? 'Chưa có tháng trước để so sánh' : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}% so với tháng trước`}</span></button>
      <button className="metric-card flow-net" onClick={() => openMonth()}><span className="metric-label">Chênh lệch thu − chi</span><Money value={data.summary.income - data.summary.expense} className={data.summary.income >= data.summary.expense ? 'positive' : 'negative'} /><span className="metric-footer">Sau các khoản chi trong kỳ <ArrowUpRight size={16} /></span></button>
    </div>

    <div className="editorial-section-head"><div><span className="section-index">02</span><h2>Hiểu dòng tiền của bạn</h2></div><button className="text-link" onClick={() => navigate('statistics')}>Báo cáo đầy đủ <ArrowRight size={16} /></button></div>
    <div className="dashboard-middle">
      <section className="panel spending-panel"><div className="panel-heading"><div><h2>Nhịp chi tiêu</h2><p>Theo từng ngày trong tháng {Number(month.slice(5))}</p></div><button className="icon-button" aria-label="Xem thống kê" onClick={() => navigate('statistics')}><ArrowUpRight size={20} /></button></div><div className="chart-meta"><Money value={data.summary.expense} /><span>tổng chi tiêu</span></div><div className="line-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dailyData} margin={{ top: 12, right: 16, left: 5, bottom: 0 }}><defs><linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart)" stopOpacity={0.2} /><stop offset="100%" stopColor="var(--chart)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="var(--line)" /><XAxis dataKey="date" axisLine={false} tickLine={false} interval={5} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip formatter={v => money(Number(v))} labelFormatter={label => `Ngày ${label}`} contentStyle={{ borderRadius: 0, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }} /><Area isAnimationActive={false} name="Chi tiêu" dataKey="expense" type="monotone" stroke="var(--chart)" strokeWidth={2.5} fill="url(#expenseGradient)" /></AreaChart></ResponsiveContainer></div></section>
      <section className="panel category-panel"><div className="panel-heading"><div><h2>Tiền đi đâu?</h2><p>Chi tiêu theo danh mục</p></div></div>{categoryData.length ? <><div className="donut-wrap"><ResponsiveContainer width="100%" height={175}><PieChart><Pie isAnimationActive={false} data={categoryData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={78} paddingAngle={3} stroke="none" onClick={(_value, index) => openCategory(categoryData[index].id)}>{categoryData.map(category => <Cell key={category.id} fill={category.color} />)}</Pie><Tooltip formatter={v => money(Number(v))} /></PieChart></ResponsiveContainer><div className="donut-center"><span>{categoryData.length}</span><small>danh mục</small></div></div><div className="category-legend">{categoryData.slice(0, 3).map(category => <button key={category.id} onClick={() => openCategory(category.id)}><span className="legend-dot" style={{ background: category.color }} /><span>{category.name}</span><strong>{data.summary.expense ? Math.round(category.value / data.summary.expense * 100) : 0}%</strong></button>)}</div></> : <EmptyState title="Chưa có khoản chi" description="Biểu đồ sẽ xuất hiện khi bạn ghi chép." action={() => openTransaction('expense')} actionLabel="Ghi khoản chi" />}</section>
    </div>
    <div className="editorial-section-head"><div><span className="section-index">03</span><h2>Sổ ghi chép</h2></div><button className="text-link" onClick={() => openMonth()}>Xem tất cả <ArrowRight size={16} /></button></div>
    <div className="dashboard-bottom"><section className="panel recent-panel">{data.recent.rows.length ? data.recent.rows.map(tx => <TransactionRow key={tx.id} transaction={tx} />) : <EmptyState action={() => openTransaction('expense')} />}</section><div className="right-stack"><button className="panel budget-summary" onClick={() => navigate('plans')}><div><span className="budget-label"><CalendarDays size={17} />Ngân sách tháng</span><ArrowUpRight size={18} /></div><h3>Ngân sách còn lại</h3>{budgetLimit ? <><Money value={budgetLimit - data.summary.expense} className="budget-remaining" /><div className="progress"><span style={{ width: `${Math.min(100, data.summary.expense / budgetLimit * 100)}%`, background: data.summary.expense > budgetLimit ? 'var(--danger)' : undefined }} /></div><small>Đã dùng {Math.round(data.summary.expense / budgetLimit * 100)}% của <Money value={budgetLimit} /></small></> : <><p>Chủ động cho tháng này.</p><span className="text-link">Đặt ngân sách <Plus size={15} /></span></>}</button><section className="panel debt-summary"><h3>Vay & cho vay</h3><button onClick={() => navigate('debts')}><span>Người khác nợ bạn</span><Money value={receivable} /></button><button onClick={() => navigate('debts')}><span>Bạn đang nợ</span><Money value={payable} /></button></section></div></div>
    {!metadata.settings.lastBackup && <button className="backup-nudge" onClick={() => navigate('settings')}><ShieldCheck size={18} /><span><strong>Một bản sao lưu. Thêm một chút an tâm.</strong><small>Lưu sổ tài chính của bạn trong Cài đặt.</small></span><ArrowRight size={18} /></button>}
  </>;
}

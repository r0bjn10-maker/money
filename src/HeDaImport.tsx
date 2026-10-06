import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ShieldCheck, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { db } from './db';
import { inspectHeDaFiles, prepareHeDaImport, commitHeDaImport, type HeDaPreview, type HeDaReport } from './heda';
import { useApp, Modal, Field, Money } from './ui';

export function HeDaReportView({ report }: { report: HeDaReport }) {
  return <div className="heda-report"><div className="small-metrics"><div><small>Dòng nguồn</small><strong>{report.sourceRows.toLocaleString('vi-VN')}</strong></div><div><small>Giao dịch app</small><strong>{report.transactionCount.toLocaleString('vi-VN')}</strong></div><div><small>Khoảng ngày</small><strong className="date-range">{report.start}<br />{report.end}</strong></div></div>
    <p className="notice">Chuyển khoản có hai vế và dòng phí được ghép; thanh toán nợ có thể tách theo khoản. Tất cả dòng gốc vẫn được lưu và liên kết với giao dịch.</p>
    <div className="simple-row"><span>Thu nhập theo loại gốc</span><Money value={report.income} /></div><div className="simple-row"><span>Chi tiêu theo loại gốc</span><Money value={report.expense} /></div><div className="simple-row"><span>Phí chuyển khoản tính riêng</span><Money value={report.feeExpense} /></div><div className="simple-row"><span>Tài sản từ ví đã xác minh</span><Money value={report.assets} /></div><div className="simple-row"><span>Tài sản ròng</span><Money value={report.netWorth} /></div><div className="simple-row"><span>Phải thu / phải trả</span><span><Money value={report.receivables} /> / <Money value={report.liabilities} /></span></div>
    <h3 className="section-subtitle">Đối chiếu</h3>{report.checks.map(check => <div key={check.label} className={`reconciliation-check ${check.status}`}><strong>{check.status === 'verified' ? '✓' : check.status === 'failed' ? '✕' : '○'} {check.label}</strong><p>{check.detail}</p>{check.status === 'unavailable' && <small>Chưa có dữ liệu nguồn để xác minh</small>}</div>)}
    {report.warnings.map((warning, i) => <p className="notice warning" key={i}><AlertCircle size={18} />{warning}</p>)}
    <details className="source-details"><summary>Số dư các ví và dư nợ theo người</summary>{Object.entries(report.walletBalances).map(([name, balance]) => <div className="simple-row" key={name}><span>{name}</span>{report.checks.some(check => check.label === 'Số dư đầu kỳ ví thiếu sổ nguồn' && check.detail.split(', ').includes(name)) ? <span>Chưa xác minh · biến động <Money value={balance} /></span> : <Money value={balance} />}</div>)}{Object.entries(report.personDebts).map(([name, balance]) => <div className="simple-row" key={name}><span>{name.replace('lend:', 'Phải thu · ').replace('borrow:', 'Phải trả · ')}</span><Money value={balance} /></div>)}</details>
  </div>;
}
export function HeDaImport({ onClose }: { onClose: () => void }) {
  const { run } = useApp(); const [preview, setPreview] = useState<HeDaPreview>(); const [report, setReport] = useState<HeDaReport>(); const [busy, setBusy] = useState(false); const [fifo, setFifo] = useState(false); const [external, setExternal] = useState(false); const [issuePage, setIssuePage] = useState(0);
  const inspect = async (files: File[]) => {
    if (!files.length || busy) return; setBusy(true);
    try { await run(async () => {
      if (files.some(file => file.size > 100000000)) throw new Error('Mỗi file phải nhỏ hơn 100 MB.');
      const parsed = await inspectHeDaFiles(await Promise.all(files.map(async file => ({ name: file.name, buffer: await file.arrayBuffer() }))));
      setPreview(await prepareHeDaImport(parsed)); setReport(undefined); setFifo(false); setExternal(false); setIssuePage(0);
    }); } finally { setBusy(false); }
  };
  const canImport = !!preview && !preview.issues.length && preview.newRows > 0 && (!preview.requiresDebtPolicy || fifo) && (!preview.externalWallets.length || external);
  return <Modal title="Nhập dữ liệu HeDa" onClose={onClose} wide><p className="notice"><ShieldCheck size={18} />Đọc file trên thiết bị, không upload. Dữ liệu hiện có được giữ nguyên.</p><p className="body-copy">Chọn cùng lúc các file của toàn bộ năm cần chuyển để liên kết nợ và đối chiếu số dư liên tục. Bản export được hỗ trợ có bảng tổng quan và một sheet chi tiết cho mỗi ví.</p>
    <Field label="Chọn các file Excel HeDa"><input type="file" multiple accept=".xlsx,.xls" disabled={busy} onChange={e => { void inspect(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></Field>{busy && <p role="status" className="notice">Đang kiểm tra tất cả dòng, chuyển khoản, khoản nợ và số dư…</p>}
    {preview && !report && <><div className="source-file-list">{preview.parsed.files.map(file => <p key={file.hash}><FileSpreadsheet size={16} />{file.name} · {file.sheets.length} sheet</p>)}</div><div className="simple-row"><span>Dòng nguồn mới / trùng đã có</span><strong>{preview.newRows.toLocaleString('vi-VN')} / {preview.duplicateRows.toLocaleString('vi-VN')}</strong></div><HeDaReportView report={preview.report} />
      {!!preview.issues.length && <><p className="notice error">Còn {preview.issues.length} lỗi. Không nhập hoặc bỏ qua dòng lỗi.</p><div className="import-issues">{preview.issues.slice(issuePage * 20, (issuePage + 1) * 20).map((issue, index) => <p key={index}>{issue.file} · {issue.sheet} · dòng {issue.row}: {issue.message}</p>)}</div><div className="pagination"><button className="button secondary" disabled={!issuePage} onClick={() => setIssuePage(p => p - 1)}>Trước</button><span>{issuePage + 1} / {Math.ceil(preview.issues.length / 20)}</span><button className="button secondary" disabled={(issuePage + 1) * 20 >= preview.issues.length} onClick={() => setIssuePage(p => p + 1)}>Sau</button></div></>}
      {!preview.issues.length && preview.newRows > 0 && <><h3 className="section-subtitle">Xác nhận dữ liệu không có liên kết gốc</h3>{preview.requiresDebtPolicy && <label className="check-field"><input type="checkbox" checked={fifo} onChange={e => setFifo(e.target.checked)} />Tôi đồng ý gán thu/trả nợ theo FIFO cho cùng người. File không có ID khoản nợ; tổng tiền và dư nợ không đổi.</label>}{preview.externalWallets.length > 0 && <label className="check-field"><input type="checkbox" checked={external} onChange={e => setExternal(e.target.checked)} />Tôi đồng ý lưu ví thiếu nguồn ({preview.externalWallets.join(', ')}) ở trạng thái lưu trữ, chưa xác minh số dư và loại khỏi tổng tài sản.</label>}<button className="button primary submit-button" disabled={busy || !canImport} onClick={async () => { setBusy(true); try { await run(async () => setReport(await commitHeDaImport(preview, { fifo, externalWallets: external })), 'Đã nhập các dòng HeDa và lưu báo cáo đối chiếu'); } finally { setBusy(false); } }}>Nhập {preview.newTransactions.toLocaleString('vi-VN')} giao dịch mới</button></>}
      {preview.newRows === 0 && <p className="notice">Tất cả dòng nguồn đã có. Không tạo dữ liệu trùng.</p>}
    </>}
    {report && <><h3 className="section-subtitle">Đã lưu dữ liệu HeDa</h3><HeDaReportView report={report} /><p className="notice">Các mục thiếu dữ liệu nguồn và quy tắc FIFO vẫn được giữ rõ trong báo cáo. Tải backup sau khi nhập để chuyển dữ liệu sang iPhone hoặc thiết bị khác.</p><button className="button primary submit-button" onClick={onClose}>Hoàn tất</button></>}
  </Modal>;
}
export function HeDaHistory({ onClose }: { onClose: () => void }) {
  const batches = useLiveQuery(() => db.importBatches.filter(batch => batch.source === 'heda').toArray(), [], []); const [selected, setSelected] = useState<string>();
  const batch = batches.find(b => b.id === selected); let report: HeDaReport | undefined;
  try { if (batch?.reconciliation) report = JSON.parse(batch.reconciliation); } catch { /* Keep original metadata intact; report the read failure below. */ }
  return <Modal title="Báo cáo nhập HeDa" onClose={onClose} wide>{!batches.length ? <p className="body-copy">Chưa có lần nhập HeDa.</p> : <Field label="Lần nhập"><select value={selected ?? ''} onChange={e => setSelected(e.target.value)}><option value="">Chọn báo cáo</option>{batches.map(b => <option key={b.id} value={b.id}>{b.importedAt.slice(0, 10)} · {b.sourceRowCount} dòng nguồn</option>)}</select></Field>}{report && <><p className="notice">Đối chiếu tại thời điểm nhập; các giao dịch chỉnh sửa hoặc thêm sau đó không thay đổi báo cáo nguồn.</p><HeDaReportView report={report} /></>}{batch && !report && <p className="notice error">Không đọc được metadata báo cáo. Dữ liệu gốc được giữ nguyên.</p>}</Modal>;
}

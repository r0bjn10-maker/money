import * as XLSX from 'xlsx';
type Row = [string, string, string, string, string, string, string];
export function makeHeDaFixture(mode: 'normal' | 'split' | 'external' | 'broken' = 'normal') {
  const book = XLSX.utils.book_new();
  let bankRows: Row[] = [
    ['Thu nợ', '', '', 'Thu nợ từ Người A', '+₫50,000', '₫719,000', '04/01/25 10:00'],
    ['Chuyển khoản', 'Đến Tiền mặt thử', '', 'Chuyển khoản', '-₫200,000', '₫669,000', '03/01/25 10:00'],
    ['Chuyển khoản', 'Đến Tiền mặt thử', '', 'Phí chuyển khoản', '-₫1,000', '₫869,000', '03/01/25 10:00'],
    ['Chi tiêu', 'Ăn uống thử', 'Bữa trưa', 'Ghi chú gốc', '-₫30,000', '₫870,000', '02/01/25 10:00'],
    ['Cho mượn', 'Cho Người A mượn', '', '', '-₫100,000', '₫900,000', '01/01/25 10:00'],
  ];
  let cashRows: Row[] = [['Chuyển khoản', 'Từ Ngân hàng thử', '', 'Chuyển khoản', '+₫200,000', '₫700,000', '03/01/25 10:00']];
  let bankClosing = 719000, cashClosing = 700000, netWorth = 1469000;
  if (mode === 'split') {
    bankRows = [['Thu nợ', '', '', 'Thu nợ từ Người A', '+₫150,000', '₫950,000', '03/01/25 10:00'], ['Cho mượn', 'Cho Người A mượn', '', '', '-₫100,000', '₫800,000', '02/01/25 10:00'], ['Cho mượn', 'Cho Người A mượn', '', '', '-₫100,000', '₫900,000', '01/01/25 10:00']];
    cashRows = []; bankClosing = 950000; cashClosing = 500000; netWorth = 1500000;
  }
  if (mode === 'external') {
    bankRows = [['Chuyển khoản', 'Từ Ví ẩn thử', '', 'Chuyển khoản', '+₫100,000', '₫1,000,000', '02/01/25 10:00'], ['Chuyển khoản', 'Đến Ví ẩn thử', '', 'Chuyển khoản', '-₫100,000', '₫900,000', '01/01/25 10:00']];
    cashRows = []; bankClosing = 1000000; cashClosing = 500000; netWorth = 1500000;
  }
  const overview: unknown[][] = Array.from({ length: 9 }, () => []);
  overview[0] = ['Bảng tổng quan']; overview[3][3] = 'Tài sản hiện có'; overview[3][4] = `₫${(bankClosing + cashClosing).toLocaleString('en-US')}`; overview[4][3] = 'Tài sản ròng'; overview[4][4] = `₫${netWorth.toLocaleString('en-US')}`;
  overview[6] = ['Tên tài sản', 'Loại tài sản', 'Đơn vị tiền tệ', 'Số dư', 'Quy đổi(VND)'];
  overview[7] = ['Ngân hàng thử', 'Tài khoản ngân hàng', 'VND', `₫${bankClosing.toLocaleString('en-US')}`, `₫${bankClosing.toLocaleString('en-US')}`]; overview[8] = ['Tiền mặt thử', 'Tiền mặt', 'VND', `₫${cashClosing.toLocaleString('en-US')}`, `₫${cashClosing.toLocaleString('en-US')}`];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(overview), 'Bảng tổng quan');
  const amount = (value: string) => Number(value.replace(/[₫,]/g, ''));
  for (const [name, opening, closing, rows] of [['Ngân hàng thử', 1000000, bankClosing, bankRows], ['Tiền mặt thử', 500000, cashClosing, cashRows]] as const) {
    const matrix: unknown[][] = Array.from({ length: 9 }, () => []);
    matrix[0][0] = 'Bảng thống kê chi tiết'; matrix[2][0] = 'Từ 1/2025 đến 12/2025'; matrix[4][0] = name; matrix[4][6] = 'Số dư đầu kỳ'; matrix[4][7] = `₫${opening.toLocaleString('en-US')}`;
    matrix[5][0] = `₫${closing.toLocaleString('en-US')}`; matrix[5][6] = 'Tổng vào 2025'; matrix[5][7] = 'Tổng ra 2025';
    matrix[6][6] = `₫${rows.reduce((sum, r) => sum + Math.max(0, amount(r[4])), 0).toLocaleString('en-US')}`; matrix[6][7] = `₫${rows.reduce((sum, r) => sum + Math.max(0, -amount(r[4])), 0).toLocaleString('en-US')}`;
    matrix[8] = ['Stt', 'Loại giao dịch', 'Danh mục', 'Danh mục con', 'Ghi chú', 'Số tiền', 'Số dư sau giao dịch', 'Thời gian'];
    rows.forEach((row, index) => matrix.push([index + 1, ...row]));
    if (mode === 'broken' && name === 'Ngân hàng thử') matrix[9][6] = '₫1';
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), name);
  }
  return [{ name: 'synthetic-heda.xlsx', buffer: XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer }];
}

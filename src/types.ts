export const APP_VERSION = '1.1.2';
export const DB_VERSION = 4;
export type TransactionType = 'expense' | 'income' | 'transfer' | 'borrow' | 'lend' | 'adjustment' | 'debt-payment';
export type WalletType = 'cash' | 'bank' | 'ewallet' | 'savings' | 'investment' | 'other';
export interface Wallet { id: string; name: string; type: WalletType; icon: string; openingBalance: number; currency: string; includeInNetWorth: boolean; archived: boolean; createdAt: string; balanceVerified?: boolean }
export interface Category { id: string; name: string; type: 'expense' | 'income'; parentId?: string; icon: string; color: string; sortOrder: number; archived: boolean }
export interface Transaction {
  id: string; type: TransactionType; amount: number; walletId: string; destinationWalletId?: string;
  transferFee: number; feeWalletId?: string; categoryId?: string; date: string; time: string;
  note: string; tags: string[]; eventId?: string; includeInReports: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string; walletIds: string[];
  debtId?: string; paymentDirection?: 'in' | 'out'; recurringKey?: string;
  source?: string; sourceId?: string; sourceFile?: string; sourceSheet?: string; sourceRow?: number; importBatchId?: string; fingerprint?: string;
}
export interface Budget { id: string; month: string; categoryId?: string; amount: number; name: string }
export interface Debt { id: string; kind: 'borrow' | 'lend'; personName: string; originalAmount: number; date: string; dueDate?: string; note: string; walletId: string; transactionId: string }
export interface DebtPayment { id: string; debtId: string; transactionId: string; amount: number; date: string }
export interface RecurringTransaction { id: string; type: 'income' | 'expense'; amount: number; categoryId: string; walletId: string; note: string; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'; interval: number; startDate: string; endDate?: string; nextRunDate: string; autoCreate: boolean; archived: boolean; anchorDay: number }
export interface FinanceEvent { id: string; name: string; startDate: string; endDate: string; expectedExpense: number; expectedIncome: number; note: string }
export interface Tag { id: string; name: string }
export interface TransactionTag { id: string; transactionId: string; tagId: string }
export interface ImportBatch { id: string; source: string; sourceFile: string; importedAt: string; count: number; income: number; expense: number; sourceRowCount?: number; reconciliation?: string }
export interface HeDaSourceRow { id: string; batchId: string; fileName: string; fileHash: string; sheet: string; row: number; ordinal: number; periodStart: string; periodEnd: string; walletName: string; originalType: string; category: string; subcategory: string; note: string; amount: number; balanceAfter: number; date: string; time: string; originalTime: string; transactionIds: string[]; purgedTransactionIds?: string[] }
export interface ImportIssue { id: string; batchId: string; row: number; message: string; raw: string }
export interface AppSettings { id: 'app'; currency: string; firstDayOfWeek: 0 | 1; dateFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd'; numberFormat: 'vi-VN' | 'en-US'; theme: 'light' | 'dark' | 'system'; defaultWalletId?: string; lastCategoryId?: string; lastBackup?: string }
export interface BackupMetadata { id: string; exportedAt: string; checksum: string }
export const transactionLabels: Record<TransactionType, string> = { expense: 'Chi tiêu', income: 'Thu nhập', transfer: 'Chuyển khoản', borrow: 'Đi vay', lend: 'Cho vay', adjustment: 'Điều chỉnh số dư', 'debt-payment': 'Trả / thu nợ' };
export const walletLabels: Record<WalletType, string> = { cash: 'Tiền mặt', bank: 'Tài khoản ngân hàng', ewallet: 'Ví điện tử', savings: 'Tiết kiệm', investment: 'Đầu tư', other: 'Tài sản khác' };

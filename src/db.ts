import Dexie, { type Table } from 'dexie';
import type { Wallet, Category, Transaction, Budget, Debt, DebtPayment, RecurringTransaction, FinanceEvent, Tag, TransactionTag, ImportBatch, ImportIssue, AppSettings, BackupMetadata, HeDaSourceRow } from './types';

export const schemaV1 = {
  wallets: 'id,type,archived', categories: 'id,type,parentId,sortOrder',
  transactions: 'id,date,walletId,categoryId,type,eventId,deletedAt,*tags',
  budgets: 'id,month,categoryId', debts: 'id,kind,transactionId', debtPayments: 'id,debtId,transactionId',
  recurring: 'id,nextRunDate', events: 'id,startDate', tags: 'id,&name', transactionTags: 'id,transactionId,tagId',
  importBatches: 'id,importedAt', importIssues: 'id,batchId', settings: 'id', backupMetadata: 'id',
};
export const schemaV2 = { ...schemaV1, transactions: 'id,date,walletId,categoryId,type,eventId,deletedAt,*tags,*walletIds,&recurringKey,fingerprint,[source+sourceId],[walletId+date],[type+date]' };
export class FinanceDB extends Dexie {
  wallets!: Table<Wallet>; categories!: Table<Category>; transactions!: Table<Transaction>;
  budgets!: Table<Budget>; debts!: Table<Debt>; debtPayments!: Table<DebtPayment>;
  recurring!: Table<RecurringTransaction>; events!: Table<FinanceEvent>; tags!: Table<Tag>;
  transactionTags!: Table<TransactionTag>; importBatches!: Table<ImportBatch>;
  importIssues!: Table<ImportIssue>; settings!: Table<AppSettings>; backupMetadata!: Table<BackupMetadata>;
  hedaSourceRows!: Table<HeDaSourceRow>;
  constructor(name = 'moc-personal-finance') {
    super(name);
    this.version(1).stores(schemaV1);
    this.version(2).stores(schemaV2).upgrade(async tx => {
      await tx.table('transactions').toCollection().modify((row: Transaction) => {
        row.walletIds = [...new Set([row.walletId, row.destinationWalletId, row.feeWalletId].filter(Boolean))] as string[];
        row.tags ??= []; row.transferFee ??= 0; row.includeInReports ??= true;
        row.time ??= '12:00'; row.note ??= '';
        row.createdAt ??= new Date().toISOString(); row.updatedAt ??= row.createdAt;
      });
    });
    // v3 only adds a chronological date/time index. IndexedDB builds it without rewriting IDs.
    this.version(3).stores({ ...schemaV2, transactions: `${schemaV2.transactions},[date+time]` });
    this.version(4).stores({ ...schemaV2, transactions: `${schemaV2.transactions},[date+time]`, hedaSourceRows: 'id,batchId,fileHash,date,sheet,*transactionIds' });
  }
}
export const db = new FinanceDB();
export const defaultSettings: AppSettings = { id: 'app', currency: 'VND', firstDayOfWeek: 1, dateFormat: 'dd/MM/yyyy', numberFormat: 'vi-VN', theme: 'system' };
export async function initializeDatabase() {
  await db.open();
  await db.transaction('rw', db.settings, db.categories, db.transactions, async () => {
    const isNewDatabase = !await db.settings.get('app');
    if (isNewDatabase) await db.settings.add(defaultSettings);
    // Seed only taxonomy on a genuinely new database. Never seed financial records on startup.
    if (isNewDatabase && !await db.categories.count() && !await db.transactions.count()) {
      const names = ['Ăn uống', 'Mua sắm', 'Di chuyển', 'Nhà cửa', 'Sức khỏe', 'Giải trí', 'Giáo dục', 'Khác'];
      const icons = ['🍜', '🛍️', '🛵', '🏠', '💚', '🎧', '📚', '✨'];
      const colors = ['#e7a465', '#86a898', '#799fbb', '#c6b088', '#c88696', '#a89cc4', '#b3bd72', '#abb4ba'];
      await db.categories.bulkAdd(names.map((name, i) => ({ id: `expense-${i}`, name, type: 'expense' as const, icon: icons[i], color: colors[i], sortOrder: i, archived: false })));
      await db.categories.bulkAdd(['Lương', 'Thưởng', 'Đầu tư', 'Thu nhập khác'].map((name, i) => ({ id: `income-${i}`, name, type: 'income' as const, icon: ['💼', '🎁', '🌱', '💰'][i], color: '#6da68c', sortOrder: i, archived: false })));
    }
  });
}

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
await mkdir('private-data/qa', { recursive: true });
try {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('heading', { name: 'Tiền rõ ràng. Sống nhẹ nhàng.' }).waitFor();
  await page.evaluate(async () => {
    const opened = indexedDB.open('moc-personal-finance');
    const db = await new Promise((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = db.transaction(['wallets', 'transactions', 'budgets'], 'readwrite');
    const timestamp = new Date().toISOString();
    for (const [id, name, type, icon, openingBalance] of [['qa-cash', 'Tiền mặt · mẫu', 'cash', '💵', 2500000], ['qa-bank', 'Ngân hàng · mẫu', 'bank', '🏦', 18000000]]) tx.objectStore('wallets').add({ id, name, type, icon, openingBalance, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: timestamp });
    for (let i = 0; i < 85; i++) {
      const d = new Date(); d.setDate(d.getDate() - (i % 65)); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; const income = i % 22 === 0;
      tx.objectStore('transactions').add({ id: `qa-tx-${i}`, type: income ? 'income' : 'expense', amount: income ? 18000000 : 25000 + (i % 13) * 35000, walletId: 'qa-bank', walletIds: ['qa-bank'], categoryId: income ? 'income-0' : `expense-${i % 8}`, date, time: '12:00', note: ['Cà phê sáng', 'Mua đồ dùng', 'Ăn trưa', 'Đi lại', 'Sách mới'][i % 5] + ' · dữ liệu mẫu', tags: [], includeInReports: true, transferFee: 0, createdAt: timestamp, updatedAt: timestamp, source: 'demo' });
    }
    const d = new Date(); const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tx.objectStore('budgets').add({ id: 'qa-budget', name: 'Ngân sách tháng · mẫu', month, amount: 10000000 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await page.locator('.asset-value').getByText(/₫/).waitFor();
  await page.screenshot({ path: 'private-data/qa/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'private-data/qa/dashboard-mobile.png', fullPage: true });
  await page.goto('http://127.0.0.1:4173/#/statistics'); await page.getByRole('heading', { name: 'Bức tranh tài chính' }).waitFor(); await page.locator('.statistics-metrics').waitFor();
  await page.screenshot({ path: 'private-data/qa/statistics-mobile.png', fullPage: true });
  console.log('Visual QA screenshots saved in ignored private-data/qa. Context contained sample data only.');
} finally { await context.close(); await browser.close(); }

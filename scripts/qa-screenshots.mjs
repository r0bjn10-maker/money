import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('private-data/qa', { recursive: true });
try {
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Tổng quan tài chính' }).waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; await document.fonts.ready; });
  await expect(page.locator('.toast-error')).toHaveCount(0);
  if (await page.getByRole('button', { name: 'Đóng thông báo' }).count()) await page.getByRole('button', { name: 'Đóng thông báo' }).click();
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
  for (const [person, amount] of [['An · mẫu', '1200000'], ['Bình · mẫu', '2500000'], ['An · mẫu', '300000']]) {
    await page.getByRole('button', { name: 'Tạo giao dịch nhanh', exact: true }).click();
    await page.getByRole('button', { name: 'Đi vay', exact: true }).click();
    await page.getByRole('textbox', { name: 'Số tiền', exact: true }).fill(amount);
    await page.getByLabel('Người cho vay', { exact: true }).fill(person);
    await page.getByRole('button', { name: 'Lưu giao dịch', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  if (await page.getByRole('button', { name: 'Đóng thông báo' }).count()) await page.getByRole('button', { name: 'Đóng thông báo' }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'private-data/qa/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'private-data/qa/dashboard-mobile.png', fullPage: true });
  await page.goto(baseUrl + '#/statistics'); await page.getByRole('heading', { name: 'Bức tranh tài chính' }).waitFor(); await page.locator('.statistics-metrics').waitFor();
  await page.screenshot({ path: 'private-data/qa/statistics-mobile.png', fullPage: true });
  for (const width of [320, 390, 649, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['dashboard', 'wallets', 'transactions', 'debts', 'statistics', 'settings']) {
      await page.goto(baseUrl + '#/' + route);
      const titles = { dashboard: 'Tổng quan tài chính', wallets: 'Ví & tài sản', transactions: 'Giao dịch', debts: 'Vay & cho vay', statistics: 'Bức tranh tài chính', settings: 'Cài đặt' };
      await page.getByRole('heading', { name: titles[route], exact: true }).waitFor();
      if (route === 'dashboard') await page.locator('.wealth-hero').waitFor();
      if (route === 'wallets') await expect(page.locator('.wallet-overview')).toContainText('77.885.000');
      if (route === 'debts') await expect(page.locator('.debt-card')).toHaveCount(2);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 390 || width === 1440) await page.screenshot({ path: `private-data/qa/${route}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl + '#/settings');
  await page.getByLabel('Giao diện').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(baseUrl + '#/dashboard');
  await page.locator('.wealth-hero').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'private-data/qa/dashboard-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Ghi khoản chi', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'private-data/qa/form-dark.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.goto(baseUrl + '#/settings');
  await page.getByLabel('Giao diện').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(baseUrl + '#/dashboard');
  await page.locator('.wealth-hero').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  if (await page.getByRole('button', { name: 'Đóng thông báo' }).count()) await page.getByRole('button', { name: 'Đóng thông báo' }).click();
  await page.screenshot({ path: 'private-data/qa/dashboard-iphone-preview.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'private-data/qa/dashboard-desktop-preview.png', fullPage: false });
  expect(errors).toEqual([]);
  console.log('Visual QA screenshots saved in ignored private-data/qa. Context contained sample data only.');
} finally { await context.close(); await browser.close(); }

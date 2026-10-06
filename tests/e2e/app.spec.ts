import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('daily ledger, budgets, trash, backup/restore and offline persistence', async ({ page, context, browserName }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tiền rõ ràng. Sống nhẹ nhàng.' })).toBeVisible();
  await expect(page.locator('.asset-value')).toContainText('0');
  await page.goto('/#/wallets'); await page.getByRole('button', { name: 'Tạo ví', exact: true }).click();
  await page.getByLabel('Tên ví').fill('Ví kiểm thử'); await page.getByLabel('Số dư đầu kỳ').fill('5000000'); await page.getByRole('button', { name: 'Lưu ví', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.wallet-card')).toContainText('5.000.000');
  await page.getByRole('button', { name: 'Tạo giao dịch nhanh' }).click(); await page.getByRole('button', { name: 'Chi tiêu', exact: true }).click();
  await page.getByRole('textbox', { name: 'Số tiền', exact: true }).fill('120000 + 35000'); await page.getByLabel('Danh mục', { exact: true }).selectOption('expense-0');
  await page.getByRole('button', { name: 'Thêm chi tiết' }).click(); await page.getByLabel('Ghi chú', { exact: true }).fill('Ăn trưa kiểm thử'); await page.getByLabel('Tags', { exact: true }).fill('work'); await page.getByRole('button', { name: 'Lưu giao dịch', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.wallet-card')).toContainText('4.845.000');
  await page.reload(); await expect(page.locator('.wallet-card')).toContainText('4.845.000');
  await page.goto('/#/transactions'); await expect(page.getByText('Ăn trưa kiểm thử', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Tìm giao dịch' }).fill('work'); await expect(page.locator('.transaction-row')).toHaveCount(1);
  await page.locator('.transaction-main').click(); await page.getByRole('button', { name: 'Nhân bản hôm nay' }).click(); await expect(page.locator('.transaction-row')).toHaveCount(2);
  await page.locator('.transaction-main').first().click(); await page.getByRole('button', { name: 'Chuyển vào thùng rác', exact: true }).click(); await page.getByRole('button', { name: 'Xác nhận', exact: true }).click(); await expect(page.locator('.transaction-row')).toHaveCount(1);
  await page.goto('/#/trash'); await expect(page.locator('.trash-row')).toHaveCount(1); await page.getByRole('button', { name: 'Khôi phục', exact: true }).click(); await expect(page.locator('.trash-row')).toHaveCount(0);
  await page.goto('/#/plans'); await page.getByRole('button', { name: 'Tạo ngân sách', exact: true }).first().click(); await page.getByLabel('Giới hạn chi').fill('2000000'); await page.getByRole('button', { name: 'Lưu ngân sách', exact: true }).click(); await expect(page.locator('.budget-card')).toContainText('310.000');
  await page.goto('/#/statistics'); await expect(page.getByRole('heading', { name: 'Bức tranh tài chính' })).toBeVisible(); await expect(page.locator('.statistics-metrics')).toContainText('310.000'); await expect(page.locator('.recharts-pie-sector').first()).toBeVisible();
  await page.goto('/#/settings'); const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Tải backup', exact: true }).click(); const download = await downloadEvent; const backupPath = await download.path(); expect(backupPath).toBeTruthy(); const backup = JSON.parse(await readFile(backupPath!, 'utf8')); expect(backup.data.transactions).toHaveLength(2); expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/); await expect(page.getByRole('heading', { name: 'Bản sao lưu đã tạo', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Hoàn tất lưu backup', exact: true }).click();
  const excelDownloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất Excel' }).click(); const excelDownload = await excelDownloadEvent; expect(excelDownload.suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByRole('button', { name: 'Xóa toàn bộ dữ liệu', exact: true }).click(); await page.getByLabel('Nhập XÓA TẤT CẢ').fill('XÓA TẤT CẢ'); await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.getByLabel('Chọn file backup', { exact: true }).setInputFiles(backupPath!); await expect(page.getByRole('heading', { name: 'Xem trước khôi phục' })).toBeVisible(); await page.getByRole('button', { name: 'Thay thế dữ liệu', exact: true }).click(); await page.getByRole('button', { name: 'Xác nhận', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#/wallets'); await expect(page.locator('.wallet-card')).toContainText('4.690.000');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  if (browserName !== 'webkit') { await context.setOffline(true); await page.reload(); await expect(page.locator('.wallet-card')).toContainText('4.690.000'); await expect(page.locator('.connection-badge')).toContainText('Offline'); }
  // WebKit offline navigation is verified separately with the origin server stopped (Playwright #42775).
  expect(errors).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); expect(overflow).toBe(false);
});

test('all navigation routes render without errors and production is empty', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  for (const [route, title] of [['wallets', 'Ví & tài sản'], ['categories', 'Danh mục'], ['plans', 'Kế hoạch chi tiêu'], ['statistics', 'Bức tranh tài chính'], ['debts', 'Vay & cho vay'], ['events', 'Sự kiện'], ['recurring', 'Giao dịch định kỳ'], ['tags', 'Tags'], ['trash', 'Thùng rác'], ['settings', 'Cài đặt'], ['more', 'Sổ của bạn']] as const) {
    await page.goto(`/#/${route}`); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await expect(page.getByText('Development tools', { exact: true })).toHaveCount(0); expect(errors).toEqual([]);
});

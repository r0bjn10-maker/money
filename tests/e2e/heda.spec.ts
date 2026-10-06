import { test, expect } from '@playwright/test';
import { makeHeDaFixture } from '../fixtures/heda-fixture';
test('HeDa preview preserves source rows, requires allocation consent, imports and deduplicates', async ({ page }) => {
  const fixture = makeHeDaFixture()[0];
  const file = { name: fixture.name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(fixture.buffer) };
  await page.goto('/#/settings'); await page.getByRole('button', { name: 'Nhập Excel HeDa', exact: false }).click();
  await page.getByLabel('Chọn các file Excel HeDa', { exact: true }).setInputFiles(file);
  const submit = page.getByRole('button', { name: 'Nhập 4 giao dịch mới', exact: true }); await expect(submit).toBeVisible(); await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /Tôi đồng ý gán thu\/trả nợ theo FIFO/ }).check(); await submit.click(); await expect(page.getByRole('heading', { name: 'Đã lưu dữ liệu HeDa', exact: true })).toBeVisible();
  await expect(page.locator('.heda-report')).toContainText('6 dòng gốc → 4 giao dịch'); await page.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  await page.goto('/#/wallets'); await expect(page.locator('.wallet-card').filter({ hasText: 'Ngân hàng thử' })).toContainText('719.000');
  await page.goto('/#/transactions'); await page.locator('.transaction-main').filter({ hasText: 'Ghi chú gốc' }).click(); await page.getByText('Dòng nguồn HeDa (1)', { exact: true }).click(); await expect(page.locator('.source-details')).toContainText('Ngân hàng thử'); await expect(page.locator('.source-details')).toContainText('Ghi chú gốc'); await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.goto('/#/settings'); await page.getByRole('button', { name: 'Nhập Excel HeDa', exact: false }).click(); await page.getByLabel('Chọn các file Excel HeDa', { exact: true }).setInputFiles(file); await expect(page.getByText('Tất cả dòng nguồn đã có. Không tạo dữ liệu trùng.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /giao dịch mới/ })).toHaveCount(0);
});

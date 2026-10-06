import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

test('WebKit opens cached app after origin server stops and writes a transaction offline', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'This test exercises WebKit without its broken setOffline emulation.');
  // https://github.com/microsoft/playwright/issues/42775
  // Real origin failure exercises the worker; setOffline incorrectly kills worker-supplied responses.
  const root = resolve('dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(`${origin}/#/wallets`); await page.getByRole('button', { name: 'Tạo ví', exact: true }).click(); await page.getByLabel('Tên ví').fill('Ví offline WebKit'); await page.getByLabel('Số dư đầu kỳ').fill('1000000'); await page.getByRole('button', { name: 'Lưu ví', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload(); await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); });
    const response = await page.reload(); expect(response?.fromServiceWorker()).toBe(true); await expect(page.locator('.wallet-card')).toContainText('1.000.000');
    await page.getByRole('button', { name: 'Tạo giao dịch nhanh' }).click(); await page.getByRole('button', { name: 'Chi tiêu', exact: true }).click(); await page.getByRole('textbox', { name: 'Số tiền', exact: true }).fill('25000'); await page.getByLabel('Danh mục', { exact: true }).selectOption('expense-0'); await page.getByRole('button', { name: 'Lưu giao dịch', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.wallet-card')).toContainText('975.000'); await page.reload(); await expect(page.locator('.wallet-card')).toContainText('975.000');
  } finally { if (server.listening) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } }
});

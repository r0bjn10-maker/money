import { test, expect } from '@playwright/test';

test('100,000 transaction history renders bounded pages with accurate balance', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'One isolated scale benchmark per run.'); test.setTimeout(120000);
  await page.goto('/#/transactions'); await expect(page.getByRole('heading', { name: 'Giao dịch', exact: true })).toBeVisible();
  const insertionMs = await page.evaluate(async () => {
    const opened = indexedDB.open('moc-personal-finance'); const database = await new Promise<IDBDatabase>((done, reject) => { opened.onsuccess = () => done(opened.result); opened.onerror = () => reject(opened.error); });
    const began = performance.now(), timestamp = new Date().toISOString(); const date = timestamp.slice(0, 10);
    const tx = database.transaction(['wallets', 'transactions'], 'readwrite');
    tx.objectStore('wallets').add({ id: 'scale-wallet', name: 'Scale test', type: 'cash', icon: '💵', openingBalance: 200000000, currency: 'VND', includeInNetWorth: true, archived: false, createdAt: timestamp });
    for (let i = 0; i < 100000; i++) tx.objectStore('transactions').add({ id: `scale-${String(i).padStart(6, '0')}`, type: 'expense', amount: 1000, walletId: 'scale-wallet', walletIds: ['scale-wallet'], categoryId: 'expense-0', date, time: `${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, note: `Scale ${i}`, tags: [], includeInReports: true, transferFee: 0, createdAt: timestamp, updatedAt: timestamp });
    await new Promise<void>((done, reject) => { tx.oncomplete = () => done(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); database.close(); return Math.round(performance.now() - began);
  });
  // Native writes deliberately bypass Dexie notifications. Reload tests a fresh 100k-record database.
  const began = Date.now(); await page.reload(); await expect(page.locator('.transaction-row')).toHaveCount(40); const firstPageMs = Date.now() - began;
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click(); await expect(page.locator('.pagination')).toContainText('Trang 2'); await expect(page.locator('.transaction-row')).toHaveCount(40);
  const balanceBegan = Date.now(); await page.goto('/#/wallets'); await expect(page.locator('.wallet-card')).toContainText('100.000.000', { timeout: 30000 }); const balanceMs = Date.now() - balanceBegan;
  await testInfo.attach('scale-measurement', { body: JSON.stringify({ records: 100000, insertionMs, firstPageMs, balanceMs, transactionNodes: 40 }), contentType: 'application/json' });
  expect(firstPageMs).toBeLessThan(10000); expect(balanceMs).toBeLessThan(30000);
});

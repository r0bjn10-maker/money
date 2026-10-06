import 'fake-indexeddb/auto';
import { beforeEach, afterAll } from 'vitest';
import { db, initializeDatabase } from '../src/db';
beforeEach(async () => {
  await db.open();
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
afterAll(() => db.close());

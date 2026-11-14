import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';

/** Kiểm thử DB cần TEST_DATABASE_URL (CI cung cấp Postgres 16). Mỗi lần chạy xoá sạch schema rồi migrate lại. */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DB_URL!);
  await db.query('drop schema if exists app cascade;');
  await migrate(db);
  return db;
}

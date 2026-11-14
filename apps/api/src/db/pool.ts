import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
/** Bất kỳ thứ gì chạy được truy vấn: pool hoặc client trong giao dịch. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Chạy fn trong một giao dịch; rollback khi lỗi. Mọi lệnh ghi nghiệp vụ + activity_events đi qua đây (AD-08). */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

/**
 * Trình chạy migration tối giản (AD-29): tệp SQL có phiên bản, mỗi tệp một giao dịch,
 * ghi checksum để phát hiện tệp đã chạy bị sửa.
 * - db/migrations/: PostgreSQL chuẩn, chạy ở mọi môi trường.
 * - db/supabase/:   đối tượng đặc thù Supabase, chỉ chạy khi includeSupabase = true.
 */
export const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db');

interface MigrationFile {
  id: string; // "migrations/0001_identity.sql"
  sql: string;
  checksum: string;
}

async function listFiles(subdir: string): Promise<MigrationFile[]> {
  const dir = path.join(DB_DIR, subdir);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8');
      return { id: `${subdir}/${name}`, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export async function migrate(db: Db, opts: { includeSupabase?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => undefined);
  await db.query(`create schema if not exists app;
  create table if not exists app.schema_migrations (
    id text primary key, checksum text not null, applied_at timestamptz not null default now())`);

  const files = [...(await listFiles('migrations')), ...(opts.includeSupabase ? await listFiles('supabase') : [])];
  const applied = new Map(
    (await db.query<{ id: string; checksum: string }>('select id, checksum from app.schema_migrations')).rows.map(
      (r) => [r.id, r.checksum],
    ),
  );

  const ran: string[] = [];
  for (const f of files) {
    const prev = applied.get(f.id);
    if (prev) {
      if (prev !== f.checksum) throw new Error(`Migration ${f.id} đã chạy nhưng nội dung bị sửa. Hãy tạo migration mới.`);
      continue;
    }
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(f.sql);
      await client.query('insert into app.schema_migrations (id, checksum) values ($1, $2)', [f.id, f.checksum]);
      await client.query('commit');
      ran.push(f.id);
      log(`applied ${f.id}`);
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`Migration ${f.id} thất bại: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

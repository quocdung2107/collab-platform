import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Thiếu DATABASE_URL');
  process.exit(1);
}
const db = createPool(url);
try {
  const ran = await migrate(db, { includeSupabase: process.argv.includes('--supabase'), log: console.log });
  console.log(ran.length ? `Đã chạy ${ran.length} migration.` : 'Không có migration mới.');
} finally {
  await db.end();
}

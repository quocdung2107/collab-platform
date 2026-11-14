import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { supabaseVerifier } from './http/auth.js';
import { NotifierRunner } from './modules/notifications/notifier.js';
import { MemoryRealtime, supabaseRealtime } from './modules/realtime/publisher.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const realtime = config.realtimeDriver === 'supabase' ? supabaseRealtime : new MemoryRealtime();
let notifier: NotifierRunner | null = null;
const app = await buildApp({
  db,
  verifyToken: supabaseVerifier(config.supabaseUrl),
  realtime,
  webOrigins: config.webOrigins,
  logger: true,
  onWrite: () => notifier?.kick(),
});
// Bộ notifier đọc outbox activity_events (AD-08) trong cùng tiến trình; quét định kỳ phòng khi lỡ tín hiệu.
notifier = new NotifierRunner(db, realtime, app.log);
notifier.start();

const shutdown = async () => {
  notifier?.stop();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });

import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { supabaseVerifier } from './http/auth.js';
import { NotifierRunner } from './modules/notifications/notifier.js';
import { MemoryRealtime, supabaseRealtime } from './modules/realtime/publisher.js';
import { supabaseStorage } from './modules/files/storage.js';
import { DeliveryRunner } from './modules/push/deliver.js';
import { webPushSender } from './modules/push/sender.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const realtime = config.realtimeDriver === 'supabase' ? supabaseRealtime : new MemoryRealtime();
let notifier: NotifierRunner | null = null;
const push = config.vapid ? webPushSender(config.vapid.publicKey, config.vapid.privateKey, config.vapid.subject) : undefined;
const app = await buildApp({
  db,
  verifyToken: supabaseVerifier(config.supabaseUrl),
  realtime,
  webOrigins: config.webOrigins,
  logger: true,
  onWrite: () => notifier?.kick(),
  push,
  storage: config.supabaseServiceKey ? supabaseStorage(config.supabaseUrl, config.supabaseServiceKey, db) : undefined,
});
// Bộ notifier đọc outbox activity_events (AD-08) trong cùng tiến trình; quét định kỳ phòng khi lỡ tín hiệu.
notifier = new NotifierRunner(db, realtime, app.log);
notifier.start();
// Kênh đẩy: gửi delivery đến hạn (debounce, giờ yên lặng, thử lại) — §8.6.
const deliveries = push ? new DeliveryRunner(db, push, app.log) : null;
deliveries?.start();

const shutdown = async () => {
  notifier?.stop();
  deliveries?.stop();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });

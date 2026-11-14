import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { supabaseVerifier } from './http/auth.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const app = await buildApp({
  db,
  verifyToken: supabaseVerifier(config.supabaseUrl),
  webOrigins: config.webOrigins,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });

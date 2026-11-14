import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { identityRoutes } from '../modules/identity/routes.js';
import { provisionUser, type UserRow } from '../modules/identity/users.js';
import { bearerToken, type TokenVerifier } from './auth.js';
import { AppError, errorHandler } from './errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
  interface FastifyRequest {
    user: UserRow | null;
    /** Người dùng đã xác thực; ném unauthenticated nếu route công khai gọi nhầm. */
    currentUser(): UserRow;
  }
}

export interface AppDeps {
  db: Db;
  verifyToken: TokenVerifier;
  webOrigins: string[];
  logger?: boolean;
}

const PUBLIC_ROUTES = new Set(['/healthz']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate('db', deps.db);
  app.decorateRequest('user', null);
  app.decorateRequest('currentUser', function (this: { user: UserRow | null }) {
    if (!this.user) throw new AppError('unauthenticated', 'Chưa đăng nhập');
    return this.user;
  });
  app.setErrorHandler(errorHandler);
  await app.register(cors, {
    origin: deps.webOrigins,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || PUBLIC_ROUTES.has(req.routeOptions.url ?? '')) return;
    const identity = await deps.verifyToken(bearerToken(req.headers.authorization));
    req.user = await provisionUser(deps.db, identity);
  });

  app.get('/healthz', async () => {
    await deps.db.query('select 1');
    return { ok: true };
  });
  await app.register(identityRoutes);
  return app;
}

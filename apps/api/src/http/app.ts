import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { groupRoutes } from '../modules/groups/routes.js';
import { messagingRoutes } from '../modules/messaging/routes.js';
import { schedulingRoutes } from '../modules/scheduling/routes.js';
import { identityRoutes } from '../modules/identity/routes.js';
import { provisionUser, type UserRow } from '../modules/identity/users.js';
import type { RealtimePublisher } from '../modules/realtime/publisher.js';
import { bearerToken, type TokenVerifier } from './auth.js';
import { AppError, errorHandler } from './errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    realtime: RealtimePublisher;
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
  realtime: RealtimePublisher;
  webOrigins: string[];
  logger?: boolean;
}

const PUBLIC_ROUTES = new Set(['/healthz']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate('db', deps.db);
  app.decorate('realtime', deps.realtime);
  app.decorateRequest('user', null);
  app.decorateRequest('currentUser', function (this: { user: UserRow | null }) {
    if (!this.user) throw new AppError('unauthenticated', 'Chưa đăng nhập');
    return this.user;
  });
  app.setErrorHandler(errorHandler);
  await app.register(cors, {
    origin: deps.webOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
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
  await app.register(groupRoutes);
  await app.register(messagingRoutes);
  await app.register(schedulingRoutes);
  return app;
}

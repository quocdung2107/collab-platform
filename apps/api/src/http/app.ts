import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';
import { groupRoutes } from '../modules/groups/routes.js';
import { messagingRoutes } from '../modules/messaging/routes.js';
import { notificationRoutes } from '../modules/notifications/routes.js';
import { availabilityRoutes } from '../modules/availability/routes.js';
import { workspaceRoutes } from '../modules/workspace/routes.js';
import { schedulingRoutes } from '../modules/scheduling/routes.js';
import { identityRoutes } from '../modules/identity/routes.js';
import { taskRoutes } from '../modules/tasks/routes.js';
import { linkRoutes } from '../modules/links/routes.js';
import { fileRoutes } from '../modules/files/routes.js';
import { setFileStorage, type FileStorage } from '../modules/files/storage.js';
import { pushRoutes } from '../modules/push/routes.js';
import { historyRoutes } from '../modules/history/routes.js';
import { planningRoutes } from '../modules/planning/routes.js';
import { setPushSender, type PushSender } from '../modules/push/sender.js';
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
  /** Gọi sau mỗi lệnh ghi thành công để notifier xử lý outbox ngay (không có trong kiểm thử: kiểm thử gọi dispatch tường minh). */
  onWrite?: () => void;
  /** Storage cho tệp (F9b); thiếu → tính năng tệp trả lỗi unavailable. */
  storage?: FileStorage;
  /** Bộ gửi Web Push (F11b); thiếu → không đăng ký thiết bị, không lên lịch delivery. */
  push?: PushSender;
}

const PUBLIC_ROUTES = new Set(['/healthz']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate('db', deps.db);
  app.decorate('realtime', deps.realtime);
  if (deps.storage) setFileStorage(deps.storage);
  setPushSender(deps.push ?? null);
  app.decorateRequest('user', null);
  app.decorateRequest('currentUser', function (this: { user: UserRow | null }) {
    if (!this.user) throw new AppError('unauthenticated', 'Chưa đăng nhập');
    return this.user;
  });
  app.setErrorHandler(errorHandler);
  await app.register(cors, {
    origin: deps.webOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
  });

  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || PUBLIC_ROUTES.has(req.routeOptions.url ?? '')) return;
    const identity = await deps.verifyToken(bearerToken(req.headers.authorization));
    req.user = await provisionUser(deps.db, identity);
  });

  if (deps.onWrite) {
    const onWrite = deps.onWrite;
    app.addHook('onResponse', async (req, reply) => {
      if (req.method !== 'GET' && req.method !== 'OPTIONS' && reply.statusCode < 400) onWrite();
    });
  }

  app.get('/healthz', async () => {
    await deps.db.query('select 1');
    return { ok: true };
  });
  await app.register(identityRoutes);
  await app.register(groupRoutes);
  await app.register(messagingRoutes);
  await app.register(schedulingRoutes);
  await app.register(notificationRoutes);
  await app.register(workspaceRoutes);
  await app.register(availabilityRoutes);
  await app.register(taskRoutes);
  await app.register(linkRoutes);
  await app.register(fileRoutes);
  await app.register(pushRoutes);
  await app.register(historyRoutes);
  await app.register(planningRoutes);
  return app;
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, parse } from '../../http/validate.js';
import { listNotifications, markAllRead, markNotificationRead, markTargetRead, notificationCounts } from './inbox.js';
import { clearSubscription, getSubscription, setSubscription, type SubTarget } from './subscriptions.js';

const listQuery = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  pending: z.enum(['true', 'false']).optional(),
});
const targetBody = z.object({ type: z.enum(['event', 'task', 'group', 'organization', 'message']), id: z.uuid() });
const subType = z.enum(['event', 'task', 'conversation']);
const subBody = z.object({ mode: z.enum(['follow', 'mute', 'all', 'mentions']) });

/** Hộp thông báo và Subscription (F11). Trạng thái đọc/Subscription không ghi ActivityEvent (DATA_MODEL §6). */
export async function notificationRoutes(app: FastifyInstance) {
  app.get('/v1/notifications', (req) => {
    const q = parse(listQuery, req.query);
    return listNotifications(app.db, req.currentUser().id, { before: q.before, limit: q.limit, pendingOnly: q.pending === 'true' });
  });
  app.get('/v1/notifications/counts', (req) => notificationCounts(app.db, req.currentUser().id));
  app.post<{ Params: { id: string } }>('/v1/notifications/:id/read', (req) => markNotificationRead(app.db, req.currentUser().id, idParam(req.params.id)));
  app.post('/v1/notifications/read-all', (req) => markAllRead(app.db, req.currentUser().id));
  app.post('/v1/notifications/read-target', (req) => markTargetRead(app.db, req.currentUser().id, parse(targetBody, req.body)));

  app.get<{ Params: { type: string; id: string } }>('/v1/subscriptions/:type/:id', (req) =>
    getSubscription(app.db, req.currentUser().id, parse(subType, req.params.type) as SubTarget, idParam(req.params.id)),
  );
  app.put<{ Params: { type: string; id: string } }>('/v1/subscriptions/:type/:id', (req) =>
    setSubscription(app.db, req.currentUser().id, parse(subType, req.params.type) as SubTarget, idParam(req.params.id), parse(subBody, req.body).mode),
  );
  app.delete<{ Params: { type: string; id: string } }>('/v1/subscriptions/:type/:id', (req) =>
    clearSubscription(app.db, req.currentUser().id, parse(subType, req.params.type) as SubTarget, idParam(req.params.id)),
  );
}

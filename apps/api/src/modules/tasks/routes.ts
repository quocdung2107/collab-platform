import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import './hooks.js';
import {
  assignTask,
  cancelTask,
  changeCollaborators,
  createTask,
  getTask,
  listEventTasks,
  listGroupTasks,
  openTaskConversation,
  respondTask,
  setTaskFlags,
  setTaskStatus,
  updateTask,
} from './tasks.js';

const title = z.string().trim().min(1, 'Bắt buộc').max(200);
const description = z.string().trim().max(5000).nullable();
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
const offset = z.number().int().min(-60 * 24 * 365).max(60 * 24 * 365);

const createBody = z.object({
  orgId: z.uuid().optional(),
  title,
  description: description.optional(),
  scope: z.object({ type: z.enum(['event', 'group', 'private']), eventId: z.uuid().optional(), groupId: z.uuid().optional() }).optional(),
  sourceMessageId: z.uuid().optional(),
  ownerId: z.uuid().nullable().optional(),
  requiresAcceptance: z.boolean().optional(),
  dueAt: instant.nullable().optional(),
  dueOffsetMin: offset.nullable().optional(),
});
const updateBody = z.object({ expectedVersion: version, title: title.optional(), description: description.optional(), dueAt: instant.nullable().optional(), dueOffsetMin: offset.nullable().optional() });
const assignBody = z.object({ expectedVersion: version, ownerId: z.uuid().nullable(), requiresAcceptance: z.boolean().optional() });
const respondBody = z.object({ response: z.enum(['accept', 'decline']), reason: z.string().trim().max(500).optional() });
const statusBody = z.object({ expectedVersion: version, status: z.enum(['open', 'in_progress', 'done']) });
const cancelBody = z.object({ expectedVersion: version, reason: z.string().trim().max(500).optional() });
const flagsBody = z.object({ blocked: z.boolean().optional(), needsHelp: z.boolean().optional() });
const collabBody = z.object({ add: z.array(z.uuid()).max(20).optional(), remove: z.array(z.uuid()).max(20).optional() });

type P = { taskId: string };

/** Task (F8, EVENT_API_CONTRACTS §5.6, §5.7). */
export async function taskRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };
  const cmd = <T>(fn: (ctx: Parameters<typeof createTask>[0], id: string, body: unknown) => Promise<T>) => (req: { params: P; body: unknown }, reply: unknown) =>
    runCommand(deps, req as never, reply as never, async (ctx) => ({ body: await fn(ctx, idParam(req.params.taskId), req.body) }));

  app.post('/v1/tasks', (req, reply) => runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createTask(ctx, parse(createBody, req.body)) })));
  app.get<{ Params: P }>('/v1/tasks/:taskId', (req) => getTask(app.db, req.currentUser().id, idParam(req.params.taskId)));
  app.get<{ Params: { eventId: string } }>('/v1/events/:eventId/tasks', (req) => listEventTasks(app.db, req.currentUser().id, idParam(req.params.eventId)));
  app.get<{ Params: { groupId: string } }>('/v1/groups/:groupId/tasks', (req) => listGroupTasks(app.db, req.currentUser().id, idParam(req.params.groupId)));

  app.patch<{ Params: P }>('/v1/tasks/:taskId', cmd((ctx, id, b) => updateTask(ctx, id, parse(updateBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/assign', cmd((ctx, id, b) => assignTask(ctx, id, parse(assignBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/respond', cmd((ctx, id, b) => respondTask(ctx, id, parse(respondBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/status', cmd((ctx, id, b) => setTaskStatus(ctx, id, parse(statusBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/cancel', cmd((ctx, id, b) => cancelTask(ctx, id, parse(cancelBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/flags', cmd((ctx, id, b) => setTaskFlags(ctx, id, parse(flagsBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/collaborators', cmd((ctx, id, b) => changeCollaborators(ctx, id, parse(collabBody, b))));
  app.post<{ Params: P }>('/v1/tasks/:taskId/conversation', cmd((ctx, id) => openTaskConversation(ctx, id)));
}

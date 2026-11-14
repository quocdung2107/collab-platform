import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { addAttachment, downloadUrl, listFor, removeAttachment, requestUpload } from './attachments.js';
import { fileStorage } from './storage.js';

const uploadBody = z.object({ filename: z.string().trim().min(1).max(255), size: z.number().int().min(0) });
const attachBody = z.object({ key: z.string().min(10).max(400), filename: z.string().trim().min(1).max(255) });
const ownerType = z.enum(['events', 'tasks']);

/** Tệp (F9b, F14-T4). */
export async function fileRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };
  app.post<{ Params: { orgId: string } }>('/v1/organizations/:orgId/uploads', (req) =>
    requestUpload(app.db, fileStorage(), req.currentUser().id, idParam(req.params.orgId), parse(uploadBody, req.body)),
  );
  app.get<{ Params: { id: string } }>('/v1/attachments/:id/url', (req) => downloadUrl(app.db, fileStorage(), req.currentUser().id, idParam(req.params.id)));
  app.delete<{ Params: { id: string } }>('/v1/attachments/:id', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removeAttachment(ctx, idParam(req.params.id)) })),
  );
  app.get<{ Params: { kind: string; id: string } }>('/v1/:kind/:id/attachments', (req) => {
    const type = parse(ownerType, req.params.kind) === 'events' ? 'event' : 'task';
    return listFor(app.db, req.currentUser().id, { type, id: idParam(req.params.id) });
  });
  app.post<{ Params: { kind: string; id: string } }>('/v1/:kind/:id/attachments', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => {
      const type = parse(ownerType, req.params.kind) === 'events' ? 'event' : 'task';
      return { status: 201, body: await addAttachment(ctx, fileStorage(), { type, id: idParam(req.params.id) }, parse(attachBody, req.body)) };
    }),
  );
}

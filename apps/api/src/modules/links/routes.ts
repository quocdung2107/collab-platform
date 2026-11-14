import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { linkObjects, related, unlink } from './links.js';

const end = z.object({ type: z.enum(['event', 'task']), id: z.uuid() });
const linkBody = z.object({ from: end, to: end });

/** Context Engine (F10): khối Liên quan, Link giữa hai đối tượng công việc. */
export async function linkRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };
  app.get<{ Params: { id: string } }>('/v1/events/:id/related', (req) => related(app.db, req.currentUser().id, 'event', idParam(req.params.id)));
  app.get<{ Params: { id: string } }>('/v1/tasks/:id/related', (req) => related(app.db, req.currentUser().id, 'task', idParam(req.params.id)));
  app.post('/v1/links', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => {
      const b = parse(linkBody, req.body);
      return { status: 201, body: await linkObjects(ctx, b.from, b.to) };
    }),
  );
  app.delete<{ Params: { id: string } }>('/v1/links/:id', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await unlink(ctx, idParam(req.params.id)) })),
  );
}

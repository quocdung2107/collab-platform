import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { addMine, listMine, removeMine } from './availability.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const body = z.object({ startsOn: day, endsOn: day });

export async function availabilityRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };
  app.get<{ Params: { orgId: string } }>('/v1/organizations/:orgId/me/unavailabilities', (req) => listMine(app.db, req.currentUser().id, idParam(req.params.orgId)));
  app.post<{ Params: { orgId: string } }>('/v1/organizations/:orgId/me/unavailabilities', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await addMine(ctx, idParam(req.params.orgId), parse(body, req.body)) })),
  );
  app.delete<{ Params: { id: string } }>('/v1/me/unavailabilities/:id', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removeMine(ctx, idParam(req.params.id)) })),
  );
}

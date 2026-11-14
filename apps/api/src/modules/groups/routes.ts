import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { addGroupMember, archiveGroup, createGroup, getGroup, listGroups, removeGroupMember, setGroupMemberRole, updateGroup } from './groups.js';

const name = z.string().trim().min(1, 'Bắt buộc').max(80);
const description = z.string().max(500);
const createBody = z.object({ name, description: description.optional() });
const updateBody = z.object({ expectedVersion: z.number().int().positive(), name: name.optional(), description: description.nullable().optional() });
const versionBody = z.object({ expectedVersion: z.number().int().positive() });
const addMemberBody = z.object({ userId: z.uuid(), role: z.enum(['leader', 'member']).default('member') });
const roleBody = z.object({ role: z.enum(['leader', 'member']) });

type P = { orgId?: string; groupId?: string; userId?: string };

export async function groupRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };

  app.get<{ Params: P; Querystring: { includeArchived?: string } }>('/v1/organizations/:orgId/groups', (req) =>
    listGroups(app.db, req.currentUser().id, idParam(req.params.orgId), req.query.includeArchived === 'true'),
  );
  app.post<{ Params: P }>('/v1/organizations/:orgId/groups', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createGroup(ctx, idParam(req.params.orgId), parse(createBody, req.body)) })),
  );
  app.get<{ Params: P }>('/v1/groups/:groupId', (req) => getGroup(app.db, req.currentUser().id, idParam(req.params.groupId)));
  app.patch<{ Params: P }>('/v1/groups/:groupId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await updateGroup(ctx, idParam(req.params.groupId), parse(updateBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/groups/:groupId/archive', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await archiveGroup(ctx, idParam(req.params.groupId), parse(versionBody, req.body).expectedVersion),
    })),
  );
  app.post<{ Params: P }>('/v1/groups/:groupId/members', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await addGroupMember(ctx, idParam(req.params.groupId), parse(addMemberBody, req.body)) })),
  );
  app.patch<{ Params: P }>('/v1/groups/:groupId/members/:userId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await setGroupMemberRole(ctx, idParam(req.params.groupId), idParam(req.params.userId), parse(roleBody, req.body).role),
    })),
  );
  app.delete<{ Params: P }>('/v1/groups/:groupId/members/:userId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await removeGroupMember(ctx, idParam(req.params.groupId), idParam(req.params.userId), false),
    })),
  );
  app.post<{ Params: P }>('/v1/groups/:groupId/leave', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removeGroupMember(ctx, idParam(req.params.groupId), ctx.user.id, true) })),
  );
}

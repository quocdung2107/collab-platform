import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from './invites.js';
import { changeMemberRole, removeMember } from './members.js';
import { createOrganization, getOrganization, listMembers, updateOrganization } from './organizations.js';
import { getMe } from './users.js';

const name = z.string().trim().min(1, 'Bắt buộc').max(120);
const timezone = z.string().min(1).max(64).refine(isTimeZone, 'Múi giờ không hợp lệ');

const createOrgBody = z.object({ name, timezone: timezone.optional() });
const updateOrgBody = z.object({
  expectedVersion: z.number().int().positive(),
  name: name.optional(),
  timezone: timezone.optional(),
  defaultEventVisibility: z.enum(['org', 'groups']).optional(),
  reconfirmThresholdMin: z.number().int().min(0).max(24 * 60).optional(),
});
const roleBody = z.object({ role: z.enum(['owner', 'admin', 'member']) });
const createInviteBody = z.object({
  role: z.enum(['admin', 'member']).default('member'),
  groupId: z.uuid().optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type P = { orgId?: string; userId?: string; inviteId?: string; token?: string };

export async function identityRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };

  app.get('/v1/me', async (req) => getMe(app.db, req.currentUser()));

  app.post('/v1/organizations', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createOrganization(ctx, parse(createOrgBody, req.body)) })),
  );
  app.get<{ Params: P }>('/v1/organizations/:orgId', (req) => getOrganization(app.db, req.currentUser().id, idParam(req.params.orgId)));
  app.patch<{ Params: P }>('/v1/organizations/:orgId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await updateOrganization(ctx, idParam(req.params.orgId), parse(updateOrgBody, req.body)),
    })),
  );

  app.get<{ Params: P }>('/v1/organizations/:orgId/members', (req) => listMembers(app.db, req.currentUser().id, idParam(req.params.orgId)));
  app.patch<{ Params: P }>('/v1/organizations/:orgId/members/:userId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await changeMemberRole(ctx, idParam(req.params.orgId), idParam(req.params.userId), parse(roleBody, req.body).role),
    })),
  );
  app.delete<{ Params: P }>('/v1/organizations/:orgId/members/:userId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await removeMember(ctx, idParam(req.params.orgId), idParam(req.params.userId), false),
    })),
  );
  app.post<{ Params: P }>('/v1/organizations/:orgId/leave', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removeMember(ctx, idParam(req.params.orgId), ctx.user.id, true) })),
  );

  app.get<{ Params: P }>('/v1/organizations/:orgId/invites', (req) => listInvites(app.db, req.currentUser().id, idParam(req.params.orgId)));
  app.post<{ Params: P }>('/v1/organizations/:orgId/invites', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      status: 201,
      body: await createInvite(ctx, idParam(req.params.orgId), parse(createInviteBody, req.body)),
    })),
  );
  app.delete<{ Params: P }>('/v1/organizations/:orgId/invites/:inviteId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await revokeInvite(ctx, idParam(req.params.orgId), idParam(req.params.inviteId)),
    })),
  );

  app.get<{ Params: P }>('/v1/invites/:token', (req) => previewInvite(app.db, req.currentUser().id, req.params.token ?? ''));
  app.post<{ Params: P }>('/v1/invites/:token/accept', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await acceptInvite(ctx, req.params.token ?? '') })),
  );
}

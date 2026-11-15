import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { cancelAssignment, replaceAssignment, respondAssignment } from './assignments.js';
import { cancelEvent, relocateEvent, rescheduleEvent } from './lifecycle.js';
import { changeOwners, createEvent, deleteDraft, getEvent, listEvents, publishEvent, updateEvent } from './events.js';
import { cancelDraftAssignment, createAssignment, createPosition, removePosition, updatePosition } from './positions.js';
import { archiveTemplate, createTemplate, listTemplates, templateFromEvent } from './templates.js';

const title = z.string().trim().min(1, 'Bắt buộc').max(200);
const text = (max: number) => z.string().trim().max(max).nullable();
const instant = z.iso.datetime({ offset: true });
const uuids = z.array(z.uuid()).max(50);
const version = z.number().int().positive();

const createEventBody = z
  .object({
    title: title.optional(),
    description: text(5000).optional(),
    location: text(300).optional(),
    startsAt: instant,
    endsAt: instant.optional(),
    groupIds: uuids.optional(),
    visibility: z.enum(['org', 'groups']).optional(),
    templateId: z.uuid().optional(),
    copyFromId: z.uuid().optional(),
    keepPeople: z.boolean().optional(),
  })
  .refine((b) => !(b.templateId && b.copyFromId), { message: 'Chọn mẫu hoặc sao chép, không cả hai', path: ['templateId'] });
const updateEventBody = z.object({
  expectedVersion: version,
  title: title.optional(),
  description: text(5000).optional(),
  location: text(300).optional(),
  startsAt: instant.optional(),
  endsAt: instant.optional(),
  groupIds: uuids.optional(),
  visibility: z.enum(['org', 'groups']).optional(),
  notifyAssignees: z.boolean().optional(),
});
const rescheduleBody = z.object({ expectedVersion: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().max(500).optional() });
const relocateBody = z.object({ expectedVersion: z.number().int().positive(), location: z.string().trim().max(300).nullable() });
const cancelBody = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().max(500).optional() });
const versionBody = z.object({ expectedVersion: version });
const ownersBody = z.object({ expectedVersion: version, add: uuids.default([]), remove: uuids.default([]) });
const positionFields = {
  name: z.string().trim().min(1, 'Bắt buộc').max(120),
  groupId: z.uuid().nullable().optional(),
  slots: z.number().int().min(1).max(100),
  reportOffsetMin: z.number().int().min(-24 * 60).max(24 * 60),
};
const createPositionBody = z.object({ ...positionFields, slots: positionFields.slots.default(1), reportOffsetMin: positionFields.reportOffsetMin.default(0) });
const updatePositionBody = z.object({
  expectedVersion: version,
  name: positionFields.name.optional(),
  groupId: positionFields.groupId,
  slots: positionFields.slots.optional(),
  reportOffsetMin: positionFields.reportOffsetMin.optional(),
});
const assignBody = z.object({ userId: z.uuid() });
const assignmentStatus = z.enum(['draft', 'requested', 'accepted', 'declined', 'reconfirm', 'cancelled']);
const respondBody = z.object({ response: z.enum(['accept', 'decline']), reason: z.string().trim().max(500).optional(), expectedStatus: assignmentStatus.optional() });
const statusBody = z.object({ expectedStatus: assignmentStatus.optional() });
const replaceBody = z.object({ newUserId: z.uuid(), expectedStatus: assignmentStatus.optional() });
const listQuery = z.object({ from: instant, to: instant, mine: z.enum(['true', 'false']).optional(), groupId: z.uuid().optional() });
export const definitionSchema = z.object({
  durationMin: z.number().int().min(5).max(7 * 24 * 60),
  groupIds: uuids.default([]),
  positions: z
    .array(z.object({ name: positionFields.name, groupId: z.uuid().nullable().default(null), slots: positionFields.slots.default(1), reportOffsetMin: positionFields.reportOffsetMin.default(0) }))
    .max(100)
    .default([]),
  tasks: z.array(z.object({ title, dueOffsetMin: z.number().int().nullable() })).max(100).default([]),
});
const templateBody = z.object({ name: z.string().trim().min(1).max(120), definition: definitionSchema });
const templateFromEventBody = z.object({ name: z.string().trim().min(1).max(120) });

type P = { orgId?: string; eventId?: string; positionId?: string; assignmentId?: string; templateId?: string };

export async function schedulingRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };

  app.get<{ Params: P }>('/v1/organizations/:orgId/events', (req) => {
    const q = parse(listQuery, req.query);
    return listEvents(app.db, req.currentUser().id, idParam(req.params.orgId), {
      from: new Date(q.from),
      to: new Date(q.to),
      mine: q.mine === 'true',
      groupId: q.groupId,
    });
  });
  app.post<{ Params: P }>('/v1/organizations/:orgId/events', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createEvent(ctx, idParam(req.params.orgId), parse(createEventBody, req.body)) })),
  );
  app.get<{ Params: P }>('/v1/events/:eventId', (req) => getEvent(app.db, req.currentUser().id, idParam(req.params.eventId)));
  app.patch<{ Params: P }>('/v1/events/:eventId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await updateEvent(ctx, idParam(req.params.eventId), parse(updateEventBody, req.body)) })),
  );
  app.delete<{ Params: P }>('/v1/events/:eventId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await deleteDraft(ctx, idParam(req.params.eventId), parse(versionBody, req.body).expectedVersion),
    })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/publish', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await publishEvent(ctx, idParam(req.params.eventId), parse(versionBody, req.body).expectedVersion),
    })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/reschedule', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await rescheduleEvent(ctx, idParam(req.params.eventId), parse(rescheduleBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/relocate', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await relocateEvent(ctx, idParam(req.params.eventId), parse(relocateBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/cancel', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await cancelEvent(ctx, idParam(req.params.eventId), parse(cancelBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/owners', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await changeOwners(ctx, idParam(req.params.eventId), parse(ownersBody, req.body)) })),
  );

  app.post<{ Params: P }>('/v1/events/:eventId/positions', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createPosition(ctx, idParam(req.params.eventId), parse(createPositionBody, req.body)) })),
  );
  app.patch<{ Params: P }>('/v1/positions/:positionId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await updatePosition(ctx, idParam(req.params.positionId), parse(updatePositionBody, req.body)) })),
  );
  app.delete<{ Params: P }>('/v1/positions/:positionId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removePosition(ctx, idParam(req.params.positionId)) })),
  );
  app.post<{ Params: P }>('/v1/positions/:positionId/assignments', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      status: 201,
      body: await createAssignment(ctx, idParam(req.params.positionId), parse(assignBody, req.body).userId),
    })),
  );
  app.delete<{ Params: P }>('/v1/assignments/:assignmentId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await cancelDraftAssignment(ctx, idParam(req.params.assignmentId)) })),
  );
  app.post<{ Params: P }>('/v1/assignments/:assignmentId/respond', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await respondAssignment(ctx, idParam(req.params.assignmentId), parse(respondBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/assignments/:assignmentId/cancel', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      body: await cancelAssignment(ctx, idParam(req.params.assignmentId), parse(statusBody, req.body).expectedStatus),
    })),
  );
  app.post<{ Params: P }>('/v1/assignments/:assignmentId/replace', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await replaceAssignment(ctx, idParam(req.params.assignmentId), parse(replaceBody, req.body)) })),
  );

  app.get<{ Params: P }>('/v1/organizations/:orgId/templates', (req) => listTemplates(app.db, req.currentUser().id, idParam(req.params.orgId)));
  app.post<{ Params: P }>('/v1/organizations/:orgId/templates', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createTemplate(ctx, idParam(req.params.orgId), parse(templateBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/events/:eventId/template', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({
      status: 201,
      body: await templateFromEvent(ctx, idParam(req.params.eventId), parse(templateFromEventBody, req.body).name),
    })),
  );
  app.post<{ Params: P }>('/v1/templates/:templateId/archive', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await archiveTemplate(ctx, idParam(req.params.templateId)) })),
  );
}

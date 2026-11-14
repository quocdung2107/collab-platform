import type { CreatedAssignmentDto } from '@collab/shared';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type PositionObject } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';
import { ACTIVE, OCCUPYING, viewEvent } from './access.js';
import { eventDetail } from './events.js';

/**
 * Position và xếp người (F4, PERMISSION_MODEL §4.4–4.5, EVENT_API_CONTRACTS §5.2).
 * position_manager = event_owner ∪ org admin ∪ leader của positions.group_id.
 */

interface PositionRow {
  id: string;
  event_id: string;
  org_id: string;
  name: string;
  group_id: string | null;
  slots: number;
  report_offset_min: number;
  sort: number;
  version: number;
}

async function groupOk(ctx: CommandCtx, orgId: string, groupId: string | null) {
  if (!groupId) return;
  const g = await ctx.tx.query(`select 1 from app.groups where id = $1 and org_id = $2 and archived_at is null`, [groupId, orgId]);
  if (!g.rowCount) throw new AppError('validation_failed', 'Nhóm không tồn tại hoặc đã lưu trữ', { fields: { groupId: 'not_found' } });
}

/** Khoá dòng Position (bất biến slots, OD-15) và kiểm tra quyền position_manager. */
async function loadPosition(ctx: CommandCtx, positionId: string) {
  const r = await ctx.tx.query<PositionRow>(
    `select id, event_id, org_id, name, group_id, slots, report_offset_min, sort, version
       from app.positions where id = $1 and removed_at is null for update`,
    [positionId],
  );
  const p = r.rows[0];
  if (!p) throw notFound();
  const ev = await viewEvent(ctx.tx, ctx.user.id, p.event_id);
  const obj: PositionObject = { type: 'position', id: p.id, orgId: p.org_id, event: ev.obj, groupId: p.group_id };
  return { p, ev, obj };
}

async function detailOf(ctx: CommandCtx, eventId: string) {
  const ev = await viewEvent(ctx.tx, ctx.user.id, eventId);
  return eventDetail(ctx.tx, ev.row, ev.obj, ev.actor);
}

const signalTopics = (status: string, eventId: string) => (status === 'draft' ? [] : [topics.event(eventId)]);

export interface PositionInput {
  name: string;
  groupId?: string | null;
  slots: number;
  reportOffsetMin: number;
}

export async function createPosition(ctx: CommandCtx, eventId: string, input: PositionInput) {
  const ev = await viewEvent(ctx.tx, ctx.user.id, eventId, true);
  const groupId = input.groupId ?? null;
  // Leader chỉ tạo Position cho nhóm của mình (§4.4).
  assertAllowed(can(ev.actor, 'position.manage', { type: 'position', id: null, orgId: ev.row.org_id, event: ev.obj, groupId }));
  await groupOk(ctx, ev.row.org_id, groupId);
  const sort = await ctx.tx.query<{ n: number }>(`select coalesce(max(sort) + 1, 0)::int as n from app.positions where event_id = $1`, [eventId]);
  const r = await ctx.tx.query<{ id: string }>(
    `insert into app.positions (org_id, event_id, name, group_id, slots, report_offset_min, sort) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [ev.row.org_id, eventId, input.name.trim(), groupId, input.slots, input.reportOffsetMin, sort.rows[0]!.n],
  );
  await emit(
    ctx,
    {
      orgId: ev.row.org_id,
      verb: 'position.created',
      object: { type: 'position', id: r.rows[0]!.id },
      context: { eventId },
      payload: { name: input.name.trim(), group_id: groupId, slots: input.slots, report_offset_min: input.reportOffsetMin },
    },
    signalTopics(ev.row.status, eventId),
  );
  return detailOf(ctx, eventId);
}

export async function updatePosition(ctx: CommandCtx, positionId: string, input: Partial<PositionInput> & { expectedVersion: number }) {
  const { p, ev, obj } = await loadPosition(ctx, positionId);
  assertAllowed(can(ev.actor, 'position.manage', obj));
  if (p.version !== input.expectedVersion) {
    throw new AppError('version_conflict', 'Vị trí đã được người khác sửa', { current: await eventDetail(ctx.tx, ev.row, ev.obj, ev.actor) });
  }
  const next = {
    name: input.name?.trim() ?? p.name,
    group_id: input.groupId === undefined ? p.group_id : input.groupId,
    slots: input.slots ?? p.slots,
    report_offset_min: input.reportOffsetMin ?? p.report_offset_min,
  };
  if (next.group_id !== p.group_id) {
    // Chuyển vị trí sang nhóm khác: phải quản lý được cả nhóm mới.
    assertAllowed(can(ev.actor, 'position.manage', { ...obj, groupId: next.group_id }));
    await groupOk(ctx, p.org_id, next.group_id);
  }
  const occupied = await ctx.tx.query<{ n: number }>(`select count(*)::int as n from app.assignments where position_id = $1 and status = any($2::text[])`, [
    positionId,
    OCCUPYING,
  ]);
  if (next.slots < occupied.rows[0]!.n) {
    throw new AppError('validation_failed', `Đã có ${occupied.rows[0]!.n} người được xếp; gỡ bớt trước khi giảm số chỗ`, { fields: { slots: 'below_filled' } });
  }
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(next) as Array<keyof typeof next>) if (next[k] !== p[k]) changes[k] = { before: p[k], after: next[k] };
  if (Object.keys(changes).length) {
    await ctx.tx.query(
      `update app.positions set name = $2, group_id = $3, slots = $4, report_offset_min = $5, version = version + 1 where id = $1`,
      [positionId, next.name, next.group_id, next.slots, next.report_offset_min],
    );
    await emit(
      ctx,
      { orgId: p.org_id, verb: 'position.updated', object: { type: 'position', id: positionId }, context: { eventId: p.event_id }, payload: { changes } },
      signalTopics(ev.row.status, p.event_id),
    );
  }
  return detailOf(ctx, p.event_id);
}

/** Gỡ Position: Assignment đang chiếm chỗ → cancelled (position_removed), sự kiện con khi Event đã publish. */
export async function removePosition(ctx: CommandCtx, positionId: string) {
  const { p, ev, obj } = await loadPosition(ctx, positionId);
  assertAllowed(can(ev.actor, 'position.manage', obj));
  await ctx.tx.query(`update app.positions set removed_at = now(), version = version + 1 where id = $1`, [positionId]);
  const rootId = await emit(
    ctx,
    { orgId: p.org_id, verb: 'position.removed', object: { type: 'position', id: positionId }, context: { eventId: p.event_id } },
    signalTopics(ev.row.status, p.event_id),
  );
  const cancelled = await ctx.tx.query<{ id: string; user_id: string; from_status: string }>(
    `update app.assignments a set status = 'cancelled', cancel_reason = 'position_removed', version = a.version + 1, updated_at = now()
       from (select id, status as from_status from app.assignments where position_id = $1 and status = any($2::text[]) for update) old
      where a.id = old.id returning a.id, a.user_id, old.from_status`,
    [positionId, OCCUPYING],
  );
  for (const a of cancelled.rows) {
    if (a.from_status === 'draft') continue; // bản nháp: không phát sự kiện Assignment
    const id = await emit(ctx, {
      orgId: p.org_id,
      verb: 'assignment.cancelled',
      object: { type: 'assignment', id: a.id },
      context: { eventId: p.event_id },
      causeId: rootId,
      payload: { assignee_id: a.user_id, position_id: positionId, cancel_reason: 'position_removed', from_status: a.from_status, replaced_by_assignment_id: null },
    });
    await ctx.realtime.send(ctx.tx, topics.user(a.user_id), 'activity', { type: 'assignment', id: a.id, verb: 'assignment.cancelled', activity_id: id });
  }
  return detailOf(ctx, p.event_id);
}

/**
 * Xếp người (§5.2). Dòng Position bị khoá nên hai người điều phối xếp đồng thời vào vị trí 1 chỗ
 * → đúng một Assignment (F4-T1). Event draft → Assignment draft, không sự kiện; published → requested.
 */
export async function createAssignment(
  ctx: CommandCtx,
  positionId: string,
  userId: string,
  opts: { causeId?: string; replacesAssignmentId?: string } = {},
): Promise<CreatedAssignmentDto> {
  const { p, ev, obj } = await loadPosition(ctx, positionId);
  assertAllowed(can(ev.actor, 'position.manage', obj));
  if (ev.row.status === 'cancelled') throw new AppError('invalid_transition', 'Buổi đã huỷ');

  const member = await ctx.tx.query(`select 1 from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`, [p.org_id, userId]);
  if (!member.rowCount) throw new AppError('not_a_member', 'Người này không phải thành viên của tổ chức');

  const occupied = await ctx.tx.query<{ user_id: string }>(
    `select user_id from app.assignments where position_id = $1 and status = any($2::text[])`,
    [positionId, OCCUPYING],
  );
  if (occupied.rows.some((a) => a.user_id === userId)) throw new AppError('duplicate_assignment', 'Người này đã được xếp vào vị trí này');
  if (occupied.rows.length >= p.slots) throw new AppError('position_full', `Vị trí đã đủ ${p.slots} người`, { current: { slots: p.slots } });

  const status = ev.row.status === 'draft' ? 'draft' : 'requested';
  const r = await ctx.tx.query<{ id: string }>(
    `insert into app.assignments (org_id, event_id, position_id, user_id, status, requested_by, requested_at, replaces_assignment_id)
     values ($1, $2, $3, $4, $5, $6, case when $5 = 'requested' then now() end, $7) returning id`,
    [p.org_id, p.event_id, positionId, userId, status, ctx.user.id, opts.replacesAssignmentId ?? null],
  );
  const assignmentId = r.rows[0]!.id;
  if (status === 'requested') {
    const id = await emit(
      ctx,
      {
        orgId: p.org_id,
        verb: 'assignment.requested',
        object: { type: 'assignment', id: assignmentId },
        context: { eventId: p.event_id },
        causeId: opts.causeId,
        payload: { assignee_id: userId, position_id: positionId, requested_by: ctx.user.id, replaces_assignment_id: opts.replacesAssignmentId ?? null },
      },
      [topics.event(p.event_id)],
    );
    await ctx.realtime.send(ctx.tx, topics.user(userId), 'activity', { type: 'assignment', id: assignmentId, verb: 'assignment.requested', activity_id: id });
  }

  // Cảnh báo trùng giờ với buổi khác người này đang có Assignment hiệu lực (F4-T3) — không chặn.
  const overlap = await ctx.tx.query<{ event_id: string; title: string; starts_at: Date }>(
    `select distinct e.id as event_id, e.title, e.starts_at
       from app.assignments a join app.events e on e.id = a.event_id
      where a.user_id = $1 and a.event_id <> $2 and a.status = any($3::text[])
        and e.status = 'published' and e.starts_at < $5 and e.ends_at > $4`,
    [userId, p.event_id, ACTIVE, ev.row.starts_at, ev.row.ends_at],
  );
  const detail = await detailOf(ctx, p.event_id);
  const dto = detail.positions.flatMap((x) => x.assignments).find((a) => a.id === assignmentId)!;
  return {
    assignment: dto,
    warnings: overlap.rows.map((o) => ({ code: 'overlapping_assignment' as const, eventId: o.event_id, title: o.title, startsAt: o.starts_at.toISOString() })),
  };
}

/** Bỏ người khỏi bản nháp (Assignment draft). Gỡ người ở buổi đã gửi là F6 (lát S7). */
export async function cancelDraftAssignment(ctx: CommandCtx, assignmentId: string) {
  const a = await ctx.tx.query<{ position_id: string; status: string }>(`select position_id, status from app.assignments where id = $1`, [assignmentId]);
  if (!a.rows[0]) throw notFound();
  const { p, ev, obj } = await loadPosition(ctx, a.rows[0].position_id);
  assertAllowed(can(ev.actor, 'position.manage', obj));
  if (a.rows[0].status !== 'draft') throw new AppError('invalid_transition', 'Buổi đã gửi: dùng thao tác gỡ người');
  await ctx.tx.query(`update app.assignments set status = 'cancelled', cancel_reason = 'removed', version = version + 1, updated_at = now() where id = $1`, [
    assignmentId,
  ]);
  return detailOf(ctx, p.event_id);
}


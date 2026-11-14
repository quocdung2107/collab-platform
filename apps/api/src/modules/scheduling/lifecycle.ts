import type { EventDto } from '@collab/shared';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { can, type ActorContext, type EventObject } from '../access/can.js';
import { emit, signalAccessChanged } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';
import { EVENT_COLS, eventObjects, type EventRow } from './access.js';
import { eventDetail, loadForEdit } from './events.js';
import { lifecycleHooks } from './hooks.js';

/**
 * Dời lịch, đổi địa điểm, huỷ Event đã công bố (F7, EVENT_API_CONTRACTS §5.5, NOTIFICATION_ENGINE §8.5).
 * Mỗi lệnh: một sự kiện gốc + các sự kiện con trong cùng giao dịch; khoá dòng Event + expected_version
 * nên dời lịch và huỷ đồng thời không trộn (F7-T9).
 */

async function loadPublished(ctx: CommandCtx, eventId: string, expectedVersion: number) {
  const v = await loadForEdit(ctx, eventId, expectedVersion);
  if (v.row.status !== 'published') throw new AppError('invalid_transition', v.row.status === 'draft' ? 'Bản nháp: sửa trực tiếp' : 'Buổi đã huỷ');
  return v;
}

async function refreshed(ctx: CommandCtx, eventId: string, actor: ActorContext): Promise<EventDto> {
  const row = (await ctx.tx.query<EventRow>(`select ${EVENT_COLS} from app.events where id = $1`, [eventId])).rows[0]!;
  return eventDetail(ctx.tx, row, (await eventObjects(ctx.tx, [row])).get(eventId)!, actor);
}

/** Đổi ngày theo múi giờ tổ chức, hoặc dời ≥ ngưỡng (OD-02 (b)). */
function needsReconfirm(before: Date, after: Date, thresholdMin: number, timeZone: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return Math.abs(after.getTime() - before.getTime()) >= thresholdMin * 60_000 || day(before) !== day(after);
}

export async function rescheduleEvent(ctx: CommandCtx, eventId: string, input: { startsAt: string; endsAt: string; reason?: string; expectedVersion: number }) {
  const { row, actor } = await loadPublished(ctx, eventId, input.expectedVersion);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt) throw new AppError('validation_failed', 'Giờ kết thúc phải sau giờ bắt đầu', { fields: { endsAt: 'before_start' } });
  if (startsAt.getTime() === row.starts_at.getTime() && endsAt.getTime() === row.ends_at.getTime()) {
    throw new AppError('validation_failed', 'Giờ không đổi', { fields: { startsAt: 'unchanged' } });
  }
  const org = (await ctx.tx.query<{ reconfirm_threshold_min: number; timezone: string }>(
    `select reconfirm_threshold_min, timezone from app.organizations where id = $1`,
    [row.org_id],
  )).rows[0]!;
  const deltaMin = Math.round((startsAt.getTime() - row.starts_at.getTime()) / 60_000);
  const reconfirm = needsReconfirm(row.starts_at, startsAt, org.reconfirm_threshold_min, org.timezone);

  await ctx.tx.query(`update app.events set starts_at = $2, ends_at = $3, version = version + 1, updated_at = now() where id = $1`, [eventId, startsAt, endsAt]);
  const rootId = await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'event.rescheduled',
      object: { type: 'event', id: eventId },
      context: { eventId },
      payload: {
        before: { starts_at: row.starts_at.toISOString(), ends_at: row.ends_at.toISOString() },
        after: { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() },
        delta_min: deltaMin,
        reason: input.reason ?? null,
        reconfirm,
      },
    },
    [topics.event(eventId)],
  );

  let reconfirmCount = 0;
  if (reconfirm) {
    const moved = await ctx.tx.query<{ id: string; user_id: string; position_id: string }>(
      `update app.assignments set status = 'reconfirm', version = version + 1, updated_at = now()
        where event_id = $1 and status = 'accepted' returning id, user_id, position_id`,
      [eventId],
    );
    for (const a of moved.rows) {
      await emit(ctx, {
        orgId: row.org_id,
        verb: 'assignment.reconfirm_requested',
        object: { type: 'assignment', id: a.id },
        context: { eventId },
        causeId: rootId,
        payload: { assignee_id: a.user_id, position_id: a.position_id },
      });
    }
    reconfirmCount = moved.rowCount ?? 0;
  }
  const tasks = await lifecycleHooks().rescheduled(ctx, { ...row, starts_at: startsAt, ends_at: endsAt }, rootId);
  const notified = await ctx.tx.query<{ n: number }>(
    `select count(distinct user_id)::int n from app.assignments where event_id = $1 and status in ('requested', 'accepted', 'reconfirm')`,
    [eventId],
  );
  return {
    event: await refreshed(ctx, eventId, actor),
    summary: { reconfirmCount, notifiedCount: notified.rows[0]!.n, tasksShifted: tasks.tasksShifted, tasksAbsoluteDue: tasks.tasksAbsoluteDue },
  };
}

export async function relocateEvent(ctx: CommandCtx, eventId: string, input: { location: string | null; expectedVersion: number }) {
  const { row, actor } = await loadPublished(ctx, eventId, input.expectedVersion);
  const location = input.location?.trim() || null;
  if (location === row.location) throw new AppError('validation_failed', 'Địa điểm không đổi', { fields: { location: 'unchanged' } });
  await ctx.tx.query(`update app.events set location = $2, version = version + 1, updated_at = now() where id = $1`, [eventId, location]);
  await emit(
    ctx,
    { orgId: row.org_id, verb: 'event.relocated', object: { type: 'event', id: eventId }, context: { eventId }, payload: { before: row.location, after: location } },
    [topics.event(eventId)],
  );
  return refreshed(ctx, eventId, actor);
}

export async function cancelEvent(ctx: CommandCtx, eventId: string, input: { reason?: string; expectedVersion: number }) {
  const { row, actor } = await loadPublished(ctx, eventId, input.expectedVersion);
  const active = await ctx.tx.query<{ id: string; user_id: string; position_id: string; status: string }>(
    `select id, user_id, position_id, status from app.assignments where event_id = $1 and status in ('requested', 'accepted', 'reconfirm') for update`,
    [eventId],
  );
  await ctx.tx.query(
    `update app.events set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, version = version + 1, updated_at = now() where id = $1`,
    [eventId, input.reason?.trim() || null],
  );
  const rootId = await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'event.cancelled',
      object: { type: 'event', id: eventId },
      context: { eventId },
      payload: { reason: input.reason?.trim() || null, active_assignee_ids: [...new Set(active.rows.map((a) => a.user_id))], task_owner_ids: [] },
    },
    [topics.event(eventId)],
  );
  await ctx.tx.query(
    `update app.assignments set status = 'cancelled', cancel_reason = 'event_cancelled', version = version + 1, updated_at = now()
      where id = any($1::uuid[])`,
    [active.rows.map((a) => a.id)],
  );
  for (const a of active.rows) {
    await emit(ctx, {
      orgId: row.org_id,
      verb: 'assignment.cancelled',
      object: { type: 'assignment', id: a.id },
      context: { eventId },
      causeId: rootId,
      payload: { assignee_id: a.user_id, position_id: a.position_id, cancel_reason: 'event_cancelled', from_status: a.status, replaced_by_assignment_id: null },
    });
  }
  const tasks = await lifecycleHooks().cancelled(ctx, row, rootId);
  if (tasks.taskOwnerIds.length) {
    await ctx.tx.query(`update app.activity_events set payload = jsonb_set(payload, '{task_owner_ids}', $2::jsonb) where id = $1`, [
      rootId,
      JSON.stringify(tasks.taskOwnerIds),
    ]);
  }
  // Thread của Event chỉ-đọc (F9-T8).
  await ctx.tx.query(`update app.conversations set read_only = true where anchor_type = 'event' and anchor_id = $1`, [eventId]);
  return refreshed(ctx, eventId, actor);
}

/**
 * Người mất quyền xem sau khi đổi visibility/nhóm (AD-31): tính view trước/sau cho mọi thành viên trong
 * bộ nhớ (2 truy vấn), xoá Subscription của người mất quyền và phát access_changed.
 */
export async function revokeLostViewers(ctx: CommandCtx, before: EventObject, after: EventObject, activityId: string) {
  const members = await ctx.tx.query<{ user_id: string; role: ActorContext['orgRole'] }>(
    `select user_id, role from app.memberships where org_id = $1 and status = 'active'`,
    [before.orgId],
  );
  const gm = await ctx.tx.query<{ user_id: string; group_id: string; role: 'leader' | 'member' }>(
    `select user_id, group_id, role from app.group_members where org_id = $1`,
    [before.orgId],
  );
  for (const m of members.rows) {
    const actor: ActorContext = {
      userId: m.user_id,
      orgId: before.orgId,
      orgRole: m.role,
      groupRoles: new Map(gm.rows.filter((g) => g.user_id === m.user_id).map((g) => [g.group_id, g.role])),
    };
    if (can(actor, 'event.view', before).allowed && !can(actor, 'event.view', after).allowed) {
      await ctx.tx.query(
        `delete from app.subscriptions where user_id = $1 and ((target_type = 'event' and target_id = $2)
            or (target_type = 'conversation' and target_id in (select id from app.conversations where anchor_type = 'event' and anchor_id = $2)))`,
        [m.user_id, before.id],
      );
      await signalAccessChanged(ctx, m.user_id, { type: 'event', id: before.id, activityId });
    }
  }
}

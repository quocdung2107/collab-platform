import type { AssignmentResultDto, CreatedAssignmentDto } from '@collab/shared';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type AssignmentObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { emit, signalAccessChanged } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';
import { eventObjects, viewEvent, type EventRow, EVENT_COLS } from './access.js';
import { eventDetail } from './events.js';
import { createAssignment } from './positions.js';

/**
 * Trả lời, gỡ, thay người (F5, F6, EVENT_API_CONTRACTS §5.3–5.4).
 * Máy trạng thái: requested|reconfirm → accepted|declined; accepted → declined. Gửi lại cùng câu trả lời
 * khi đã ở trạng thái đích → thành công, không sự kiện (F5-T2).
 */

type Status = AssignmentObject['status'];
interface Row {
  id: string;
  org_id: string;
  event_id: string;
  position_id: string;
  user_id: string;
  status: Status;
  version: number;
  group_id: string | null;
}

async function load(ctx: CommandCtx, assignmentId: string) {
  const r = await ctx.tx.query<Row>(
    `select a.id, a.org_id, a.event_id, a.position_id, a.user_id, a.status, a.version, p.group_id
       from app.assignments a join app.positions p on p.id = a.position_id
      where a.id = $1 for update of a`,
    [assignmentId],
  );
  const a = r.rows[0];
  if (!a) throw notFound();
  // Khoá Position để thay người không vượt slots khi đồng thời với xếp người (OD-15).
  await ctx.tx.query(`select 1 from app.positions where id = $1 for update`, [a.position_id]);
  const ev = await viewEvent(ctx.tx, ctx.user.id, a.event_id);
  const obj: AssignmentObject = {
    type: 'assignment',
    id: a.id,
    orgId: a.org_id,
    userId: a.user_id,
    status: a.status,
    position: { type: 'position', id: a.position_id, orgId: a.org_id, event: ev.obj, groupId: a.group_id },
  };
  return { a, ev, obj };
}

const stateConflict = (status: Status, message: string) => new AppError('state_conflict', message, { current: { status } });

export async function respondAssignment(
  ctx: CommandCtx,
  assignmentId: string,
  input: { response: 'accept' | 'decline'; reason?: string; expectedStatus?: Status },
) {
  const { a, ev, obj } = await load(ctx, assignmentId);
  assertAllowed(can(ev.actor, 'assignment.respond', obj));
  const target: Status = input.response === 'accept' ? 'accepted' : 'declined';
  if (a.status === target) return result(ctx, a, target); // F5-T2: idempotent
  if (a.status === 'cancelled') throw stateConflict(a.status, 'Bạn đã được gỡ khỏi vị trí này'); // F5-T3
  if (input.expectedStatus && input.expectedStatus !== a.status) throw stateConflict(a.status, 'Trạng thái đã thay đổi');
  const allowed = input.response === 'accept' ? ['requested', 'reconfirm'] : ['requested', 'reconfirm', 'accepted'];
  if (!allowed.includes(a.status)) throw stateConflict(a.status, input.response === 'accept' ? 'Không thể nhận lại sau khi đã từ chối' : 'Không thể từ chối lúc này'); // F5-T7
  const reason = input.reason?.trim();
  if (input.response === 'decline' && !reason) throw new AppError('validation_failed', 'Cần lý do từ chối', { fields: { reason: 'required' } });

  await ctx.tx.query(
    `update app.assignments set status = $2, decline_reason = $3, responded_at = now(), responded_by = $4, version = version + 1, updated_at = now()
      where id = $1`,
    [assignmentId, target, input.response === 'decline' ? reason : null, ctx.user.id],
  );
  const activityId = await emit(
    ctx,
    {
      orgId: a.org_id,
      verb: input.response === 'accept' ? 'assignment.accepted' : 'assignment.declined',
      object: { type: 'assignment', id: assignmentId },
      context: { eventId: a.event_id },
      payload: {
        assignee_id: a.user_id,
        position_id: a.position_id,
        responded_by: ctx.user.id,
        from_status: a.status,
        ...(input.response === 'decline' ? { reason } : {}),
      },
    },
    [topics.event(a.event_id)],
  );
  // Từ chối ở buổi visibility = groups có thể làm người ngoài nhóm mất quyền xem.
  if (target === 'declined') await afterLeaving(ctx, a.user_id, ev.row, activityId);
  return result(ctx, a, target);
}

/** Gỡ người khỏi buổi đã gửi (§5.4 "gỡ không thay"): cancelled (removed). */
export async function cancelAssignment(ctx: CommandCtx, assignmentId: string, expectedStatus?: Status) {
  const { a, ev, obj } = await load(ctx, assignmentId);
  assertAllowed(can(ev.actor, 'assignment.manage', obj));
  if (expectedStatus && expectedStatus !== a.status) throw stateConflict(a.status, 'Trạng thái đã thay đổi');
  if (!['requested', 'accepted', 'reconfirm', 'declined'].includes(a.status)) throw stateConflict(a.status, 'Không còn ở vị trí này');
  const activityId = await cancel(ctx, a, 'removed', null);
  await afterLeaving(ctx, a.user_id, ev.row, activityId);
  return result(ctx, a, 'cancelled');
}

/**
 * Thay người (§5.4): một giao dịch — cũ cancelled (replaced) + mới requested (replaces_assignment_id).
 * Mới lỗi (trùng, không phải thành viên) → huỷ toàn bộ, cũ giữ nguyên (F6-T3).
 */
export async function replaceAssignment(ctx: CommandCtx, assignmentId: string, input: { newUserId: string; expectedStatus?: Status }): Promise<CreatedAssignmentDto> {
  const { a, ev, obj } = await load(ctx, assignmentId);
  assertAllowed(can(ev.actor, 'assignment.manage', obj));
  if (ev.row.status !== 'published') throw new AppError('invalid_transition', 'Chỉ thay người ở buổi đã công bố');
  if (input.expectedStatus && input.expectedStatus !== a.status) throw stateConflict(a.status, 'Trạng thái đã thay đổi');
  if (!['requested', 'accepted', 'reconfirm', 'declined'].includes(a.status)) throw stateConflict(a.status, 'Không còn ở vị trí này');
  if (input.newUserId === a.user_id) throw new AppError('duplicate_assignment', 'Người này đã ở vị trí này');

  const rootId = await cancel(ctx, a, 'replaced', null);
  const created = await createAssignment(ctx, a.position_id, input.newUserId, { causeId: rootId, replacesAssignmentId: a.id });
  await ctx.tx.query(`update app.activity_events set payload = payload || jsonb_build_object('replaced_by_assignment_id', $2::text) where id = $1`, [
    rootId,
    created.assignment.id,
  ]);
  await afterLeaving(ctx, a.user_id, ev.row, rootId);
  return created;
}

async function cancel(ctx: CommandCtx, a: Row, reason: 'removed' | 'replaced', causeId: string | null) {
  await ctx.tx.query(
    `update app.assignments set status = 'cancelled', cancel_reason = $2, version = version + 1, updated_at = now() where id = $1`,
    [a.id, reason],
  );
  return emit(
    ctx,
    {
      orgId: a.org_id,
      verb: 'assignment.cancelled',
      object: { type: 'assignment', id: a.id },
      context: { eventId: a.event_id },
      causeId: causeId ?? undefined,
      payload: { assignee_id: a.user_id, position_id: a.position_id, cancel_reason: reason, from_status: a.status, replaced_by_assignment_id: null },
    },
    [topics.event(a.event_id), topics.user(a.user_id)],
  );
}

/**
 * Người rời vị trí có thể mất quyền xem Event (visibility = groups, F6-T4): xoá Subscription của họ trên
 * Event và thread, phát access_changed (AD-31). Không mất quyền → không làm gì.
 */
export async function afterLeaving(ctx: CommandCtx, userId: string, row: EventRow, activityId: string) {
  const fresh = (await ctx.tx.query<EventRow>(`select ${EVENT_COLS} from app.events where id = $1`, [row.id])).rows[0]!;
  const obj = (await eventObjects(ctx.tx, [fresh])).get(fresh.id)!;
  const actor = await loadActorContext(ctx.tx, userId, fresh.org_id);
  if (can(actor, 'event.view', obj).allowed) return;
  await ctx.tx.query(
    `delete from app.subscriptions where user_id = $1 and ((target_type = 'event' and target_id = $2)
        or (target_type = 'conversation' and target_id in (select id from app.conversations where anchor_type = 'event' and anchor_id = $2)))`,
    [userId, fresh.id],
  );
  await signalAccessChanged(ctx, userId, { type: 'event', id: fresh.id, activityId });
}

/** Kết quả lệnh: trạng thái mới + Event nếu người gọi còn xem được (trả lời/gỡ có thể làm mất quyền xem). */
async function result(ctx: CommandCtx, a: Row, status: Status): Promise<AssignmentResultDto> {
  try {
    const ev = await viewEvent(ctx.tx, ctx.user.id, a.event_id);
    return { assignmentId: a.id, status, event: await eventDetail(ctx.tx, ev.row, ev.obj, ev.actor) };
  } catch (e) {
    if (e instanceof AppError && e.code === 'not_found') return { assignmentId: a.id, status, event: null };
    throw e;
  }
}

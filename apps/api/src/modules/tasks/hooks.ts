import type { WorkspaceTaskDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { emit } from '../activity/emit.js';
import { registerViewer } from '../notifications/visibility.js';
import { topics } from '../realtime/publisher.js';
import { registerEventLifecycleHooks } from '../scheduling/hooks.js';
import { registerTaskSource } from '../workspace/workspace.js';
import { viewTask } from './access.js';

/**
 * Nối module Task vào các module khác qua điểm đăng ký (không phụ thuộc ngược):
 * N3 (registerViewer), My Workspace (registerTaskSource), dời lịch/huỷ Event (registerEventLifecycleHooks).
 */

registerViewer('task', (db, u, id) => viewTask(db, u, id));

registerEventLifecycleHooks({
  // §8.5: Task chưa xong có due_offset_min → due_at tính lại, task.due_changed (by_reschedule) con của gốc.
  async rescheduled(ctx, event, rootId) {
    const shifted = await ctx.tx.query<{ id: string; before: Date; after: Date }>(
      `with s as (select id, due_at as before from app.tasks
                   where event_id = $1 and status in ('open', 'in_progress') and due_offset_min is not null for update)
       update app.tasks t set due_at = $2::timestamptz + make_interval(mins => t.due_offset_min), version = t.version + 1, updated_at = now()
         from s where t.id = s.id and t.due_at is distinct from $2::timestamptz + make_interval(mins => t.due_offset_min)
       returning t.id, s.before, t.due_at as after`,
      [event.id, event.starts_at],
    );
    for (const t of shifted.rows) {
      await emit(
        ctx,
        {
          orgId: event.org_id,
          verb: 'task.due_changed',
          object: { type: 'task', id: t.id },
          context: { taskId: t.id, eventId: event.id },
          causeId: rootId,
          payload: { before: t.before.toISOString(), after: t.after.toISOString(), by_reschedule: true },
        },
        [topics.task(t.id)],
      );
    }
    const absolute = await ctx.tx.query<{ id: string; title: string; due_at: Date }>(
      `select id, title, due_at from app.tasks
        where event_id = $1 and status in ('open', 'in_progress') and due_offset_min is null and due_at is not null order by due_at`,
      [event.id],
    );
    return {
      tasksShifted: shifted.rowCount ?? 0,
      tasksAbsoluteDue: absolute.rows.map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at.toISOString() })),
    };
  },

  // Huỷ buổi: Task chưa xong → cancelled (con); owner của chúng được ghi vào payload event.cancelled (§4 bảng audience).
  async cancelled(ctx, event, rootId) {
    const r = await ctx.tx.query<{ id: string; owner_id: string | null }>(
      `update app.tasks set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now()
        where event_id = $1 and status in ('open', 'in_progress') returning id, owner_id`,
      [event.id],
    );
    for (const t of r.rows) {
      await emit(
        ctx,
        {
          orgId: event.org_id,
          verb: 'task.cancelled',
          object: { type: 'task', id: t.id },
          context: { taskId: t.id, eventId: event.id },
          causeId: rootId,
          payload: { reason: 'event_cancelled' },
        },
        [topics.task(t.id)],
      );
    }
    return { taskOwnerIds: [...new Set(r.rows.map((t) => t.owner_id).filter((x): x is string => !!x))] };
  },
});

interface WRow {
  id: string;
  org_id: string;
  org_name: string;
  title: string;
  status: 'open' | 'in_progress';
  acceptance: WorkspaceTaskDto['acceptance'];
  due_at: Date | null;
  scope_type: WorkspaceTaskDto['scope']['type'];
  scope_id: string | null;
  scope_name: string | null;
}
const W_SELECT = `
  select t.id, t.org_id, o.name as org_name, t.title, t.status, t.acceptance, t.due_at, t.scope_type,
         coalesce(t.event_id, t.group_id) as scope_id, coalesce(e.title, g.name) as scope_name
    from app.tasks t
    join app.organizations o on o.id = t.org_id and o.deleted_at is null
    join app.memberships m on m.org_id = t.org_id and m.user_id = $1 and m.status = 'active'
    left join app.events e on e.id = t.event_id
    left join app.groups g on g.id = t.group_id`;
const toW = (r: WRow): WorkspaceTaskDto => ({
  kind: 'task',
  id: r.id,
  orgId: r.org_id,
  orgName: r.org_name,
  title: r.title,
  status: r.status,
  acceptance: r.acceptance,
  dueAt: r.due_at?.toISOString() ?? null,
  overdue: !!r.due_at && r.due_at.getTime() < Date.now(),
  scope: { type: r.scope_type, id: r.scope_id, name: r.scope_name },
});

registerTaskSource({
  async needsResponse(db: Queryable, userId: string) {
    const r = await db.query<WRow>(`${W_SELECT} where t.owner_id = $1 and t.acceptance = 'pending' and t.status in ('open', 'in_progress') order by t.due_at nulls last`, [
      userId,
    ]);
    return r.rows.map(toW);
  },
  // Việc của tôi: đã nhận hoặc không cần nhận; có hạn trong 14 ngày, quá hạn, hoặc không hạn (F12-T3).
  async upcoming(db: Queryable, userId: string, horizon: Date) {
    const r = await db.query<WRow>(
      `${W_SELECT} where t.owner_id = $1 and t.acceptance in ('none', 'accepted') and t.status in ('open', 'in_progress')
         and (t.due_at is null or t.due_at <= $2)`,
      [userId, horizon],
    );
    return r.rows.map(toW);
  },
  async declinedByOthers(db: Queryable, userId: string) {
    const r = await db.query<{ id: string; title: string; org_name: string; declined_by: string }>(
      `select t.id, t.title, o.name as org_name, u.display_name as declined_by
         from app.tasks t
         join app.organizations o on o.id = t.org_id and o.deleted_at is null
         join app.memberships m on m.org_id = t.org_id and m.user_id = $1 and m.status = 'active'
         join app.users u on u.id = t.owner_id
        where t.assigned_by = $1 and t.acceptance = 'declined' and t.status in ('open', 'in_progress')
        order by t.updated_at desc limit 50`,
      [userId],
    );
    return r.rows.map((t) => ({ id: t.id, title: t.title, orgName: t.org_name, declinedBy: t.declined_by }));
  },
});

/**
 * Gỡ thành viên khỏi tổ chức (PERMISSION_MODEL §7, F1-T5): Task chưa xong đang là owner → owner rỗng qua
 * task.assigned (con của member.removed), người giao nhận "Cần bạn: giao lại". Người giao không còn là thành
 * viên (hoặc chính là người bị gỡ) → người thực hiện lệnh gỡ nhận thay (như IN-25). Gỡ khỏi task_collaborators.
 */
export async function releaseMemberFromTasks(ctx: CommandCtx, orgId: string, userId: string, rootId: string) {
  const owned = await ctx.tx.query<{ id: string; event_id: string | null; group_id: string | null; assigned_by: string | null; active: boolean }>(
    `update app.tasks t set owner_id = null, acceptance = 'none', decline_reason = null, version = t.version + 1, updated_at = now()
      where t.org_id = $1 and t.owner_id = $2 and t.status in ('open', 'in_progress')
     returning t.id, t.event_id, t.group_id, t.assigned_by,
               exists (select 1 from app.memberships m where m.org_id = $1 and m.user_id = t.assigned_by and m.status = 'active' and m.user_id <> $2) as active`,
    [orgId, userId],
  );
  for (const t of owned.rows) {
    const heir = t.active ? t.assigned_by : ctx.user.id;
    await emit(
      ctx,
      {
        orgId,
        verb: 'task.assigned',
        object: { type: 'task', id: t.id },
        context: { taskId: t.id, ...(t.event_id ? { eventId: t.event_id } : {}), ...(t.group_id ? { groupId: t.group_id } : {}) },
        causeId: rootId,
        payload: { from_owner_id: userId, to_owner_id: null, assigned_by: heir, requires_acceptance: false },
      },
      [topics.task(t.id)],
    );
  }
  await ctx.tx.query(`delete from app.task_collaborators where org_id = $1 and user_id = $2`, [orgId, userId]);
}

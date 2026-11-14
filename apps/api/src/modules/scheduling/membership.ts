import type { CommandCtx } from '../../http/command.js';
import { emit } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';

/**
 * Hệ quả lịch khi một người rời/bị gỡ khỏi tổ chức (PERMISSION_MODEL §7, F1-T4). Sự kiện con mang cause_id
 * = member.removed nên người điều phối nhận MỘT bản ghi "Cần bạn" gồm mọi vị trí bị trống.
 */
export async function releaseMemberFromScheduling(ctx: CommandCtx, orgId: string, userId: string, rootId: string) {
  // Assignment ở buổi tương lai → cancelled (member_left). Bản nháp: huỷ lặng lẽ (chưa ai được báo).
  const cancelled = await ctx.tx.query<{ id: string; event_id: string; position_id: string; from_status: string; event_status: string }>(
    `with c as (
       select a.id, a.status as from_status from app.assignments a join app.events e on e.id = a.event_id
        where a.org_id = $1 and a.user_id = $2 and a.status in ('draft', 'requested', 'accepted', 'reconfirm')
          and e.status <> 'cancelled' and e.starts_at > now()
        for update of a)
     update app.assignments a set status = 'cancelled', cancel_reason = 'member_left', version = a.version + 1, updated_at = now()
       from c, app.events e
      where a.id = c.id and e.id = a.event_id
     returning a.id, a.event_id, a.position_id, c.from_status, e.status as event_status`,
    [orgId, userId],
  );
  for (const a of cancelled.rows) {
    if (a.from_status === 'draft') continue;
    await emit(
      ctx,
      {
        orgId,
        verb: 'assignment.cancelled',
        object: { type: 'assignment', id: a.id },
        context: { eventId: a.event_id },
        causeId: rootId,
        payload: { assignee_id: userId, position_id: a.position_id, cancel_reason: 'member_left', from_status: a.from_status, replaced_by_assignment_id: null },
      },
      [topics.event(a.event_id)],
    );
  }

  // Gỡ khỏi event_owners. Event còn mở mất người phụ trách cuối → người thực hiện lệnh (hoặc chủ sở hữu tổ chức) nhận thay (IN-25).
  const owned = await ctx.tx.query<{ event_id: string; status: string }>(
    `delete from app.event_owners o using app.events e where e.id = o.event_id and o.org_id = $1 and o.user_id = $2 returning o.event_id, e.status`,
    [orgId, userId],
  );
  for (const o of owned.rows) {
    const left = await ctx.tx.query(`select 1 from app.event_owners where event_id = $1`, [o.event_id]);
    const added: string[] = [];
    if (!left.rowCount && o.status !== 'cancelled') {
      const heir = await ctx.tx.query<{ user_id: string }>(
        `select user_id from app.memberships where org_id = $1 and status = 'active' and user_id <> $2
          order by (user_id = $3) desc, (role = 'owner') desc, (role = 'admin') desc, joined_at limit 1`,
        [orgId, userId, ctx.user.id],
      );
      const h = heir.rows[0];
      if (h) {
        await ctx.tx.query(`insert into app.event_owners (event_id, user_id, org_id, added_by) values ($1, $2, $3, $4)`, [o.event_id, h.user_id, orgId, ctx.user.id]);
        added.push(h.user_id);
      }
    }
    await emit(
      ctx,
      { orgId, verb: 'event.owner_changed', object: { type: 'event', id: o.event_id }, context: { eventId: o.event_id }, causeId: rootId, payload: { added, removed: [userId] } },
      [topics.event(o.event_id)],
    );
  }

  await ctx.tx.query(`delete from app.subscriptions where org_id = $1 and user_id = $2`, [orgId, userId]);
}

import type { CommandCtx } from '../../http/command.js';
import { emit } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';
import { ACTIVE } from './access.js';
import { loadForEdit } from './events.js';
import { cancelEvent } from './lifecycle.js';

/**
 * Xoá buổi ở mọi trạng thái (AD-33). Quyền = event.edit (org admin, event_owner — PERMISSION_MODEL §4.4).
 * - Bản nháp lẻ (chưa từng công bố, không thuộc nhịp): xoá cứng như trước (DATA_MODEL §5).
 * - Còn lại (đã công bố, đã huỷ, đã qua, hoặc thuộc nhịp): ẩn mềm bằng deleted_at; dòng giữ cho lịch sử và
 *   tham chiếu đa hình (AD-04). Buổi thuộc nhịp giữ chỗ (series_id, occurrence_on) nên ngày đó thành "đã xoá",
 *   không hiện lại thành "dự kiến".
 * - Buổi đã công bố chưa kết thúc: huỷ trước (người được xếp được báo, F7), rồi mới ẩn.
 *   Buổi đã qua: không báo ai (tránh thông báo "huỷ" cho việc đã xong).
 */
export interface RemovedEvent {
  id: string;
  mode: 'hard' | 'soft';
  /** Số người nhận thông báo huỷ (chỉ khi buổi sắp tới đã công bố). */
  notifiedCount: number;
}

export async function removeEvent(ctx: CommandCtx, eventId: string, input: { expectedVersion: number; reason?: string }): Promise<RemovedEvent> {
  const { row } = await loadForEdit(ctx, eventId, input.expectedVersion);
  if (row.status === 'draft' && row.series_id === null) {
    await ctx.tx.query(`delete from app.activity_events where event_id = $1`, [eventId]);
    await ctx.tx.query(`delete from app.events where id = $1`, [eventId]);
    return { id: eventId, mode: 'hard', notifiedCount: 0 };
  }
  let version = row.version;
  let notifiedCount = 0;
  if (row.status === 'published' && row.ends_at.getTime() > Date.now()) {
    const active = await ctx.tx.query<{ n: number }>(
      `select count(distinct user_id)::int as n from app.assignments where event_id = $1 and status = any($2::text[])`,
      [eventId, [...ACTIVE]],
    );
    notifiedCount = active.rows[0]!.n;
    version = (await cancelEvent(ctx, eventId, { expectedVersion: version, reason: input.reason })).version;
  }
  await ctx.tx.query(
    `update app.events set deleted_at = now(), deleted_by = $2, version = $3 + 1, updated_at = now() where id = $1`,
    [eventId, ctx.user.id, version],
  );
  await ctx.tx.query(`update app.conversations set read_only = true where anchor_type = 'event' and anchor_id = $1`, [eventId]);
  await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'event.deleted',
      object: { type: 'event', id: eventId },
      context: { eventId },
      payload: { title: row.title, status: row.status, starts_at: row.starts_at.toISOString(), series_id: row.series_id, reason: input.reason?.trim() || null },
    },
    [topics.event(eventId)],
  );
  return { id: eventId, mode: 'soft', notifiedCount };
}

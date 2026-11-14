import type { CommandCtx } from '../../http/command.js';
import { topics } from '../realtime/publisher.js';
import { recordActivity, type ActivityInput } from './record.js';

/**
 * Ghi sự kiện miền của người dùng đang thực hiện lệnh, rồi (tuỳ chọn) đẩy tín hiệu realtime
 * {type, id, verb, activity_id} tới các kênh. Trả về id sự kiện để làm cause_id cho sự kiện con.
 */
export async function emit(
  ctx: CommandCtx,
  e: Omit<ActivityInput, 'actor' | 'requestId'>,
  realtimeTopics: string[] = [],
): Promise<string> {
  const { id } = await recordActivity(ctx.tx, {
    ...e,
    actor: { type: 'user', id: ctx.user.id },
    requestId: ctx.requestId ?? undefined,
  });
  for (const topic of realtimeTopics) {
    await ctx.realtime.send(ctx.tx, topic, 'activity', { type: e.object.type, id: e.object.id, verb: e.verb, activity_id: id });
  }
  return id;
}

/**
 * AD-31: quyền đọc của userId vừa thay đổi. Máy khách nhận phải làm mới JWT và gửi lại cho Realtime
 * để kênh không còn quyền bị đóng, đồng thời xoá dữ liệu đệm liên quan.
 */
export async function signalAccessChanged(ctx: CommandCtx, userId: string, cause: { type: string; id: string; activityId: string }) {
  await ctx.realtime.send(ctx.tx, topics.user(userId), 'access_changed', {
    type: cause.type,
    id: cause.id,
    verb: 'access.changed',
    activity_id: cause.activityId,
  });
}

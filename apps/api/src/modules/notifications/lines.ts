import type { Queryable } from '../../db/pool.js';
import { CANCEL_REASON, lookup, when } from './lookup.js';
import type { Activity } from './types.js';

/** Hội thoại nhận dòng hệ thống của một sự kiện (phạm vi "scope", NOTIFICATION_ENGINE §5). † = thêm hội thoại các nhóm của Event. */
const DAGGER = new Set(['event.published', 'event.rescheduled', 'event.relocated', 'event.cancelled']);

export function scopeAnchors(a: Activity, eventGroupIds: string[]): Array<{ type: 'group' | 'event' | 'task'; id: string }> {
  const [domain] = a.verb.split('.');
  // Sự kiện con của Assignment đã được nói gọn trong dòng của sự kiện gốc (publish, huỷ, bỏ vị trí).
  if (a.cause_id && domain === 'assignment') return [];
  if (domain === 'event' || domain === 'position' || domain === 'assignment') {
    if (!a.event_id || a.verb === 'event.created' || a.verb === 'event.plan_changed') return [];
    return [{ type: 'event', id: a.event_id }, ...(DAGGER.has(a.verb) ? eventGroupIds.map((id) => ({ type: 'group' as const, id })) : [])];
  }
  if (domain === 'task' && a.verb !== 'task.created') return [{ type: 'task', id: a.object_id }];
  if (a.verb === 'task.created' && a.task_id) return [{ type: 'task', id: a.task_id }];
  if (a.verb === 'group.member_added' || a.verb === 'group.member_removed' || a.verb === 'group.member_role_changed') {
    return [{ type: 'group', id: a.object_id }];
  }
  return [];
}

/** Câu của dòng hệ thống, chụp tại lúc chiếu (không chứa nội dung tin nhắn hay lý do từ chối). */
export async function systemLine(db: Queryable, a: Activity): Promise<string | null> {
  const L = lookup(db);
  const p = a.payload;
  const actor = await L.userName(a.actor_id);
  const tz = await L.orgTimezone(a.org_id);
  switch (a.verb) {
    case 'event.published':
      return `${actor} đã công bố buổi ${await eventTitle(db, a.event_id)} (${when(p.starts_at, tz)}).`;
    case 'event.updated':
      return `${actor} đã cập nhật thông tin buổi.`;
    case 'event.rescheduled':
      return `${actor} đã dời buổi ${await eventTitle(db, a.event_id)}: ${when(p.before?.starts_at, tz)} → ${when(p.after?.starts_at, tz)}.`;
    case 'event.relocated':
      return `${actor} đã đổi địa điểm buổi ${await eventTitle(db, a.event_id)}: ${p.before ?? '—'} → ${p.after ?? '—'}.`;
    case 'event.cancelled':
      return `${actor} đã huỷ buổi ${await eventTitle(db, a.event_id)}.`;
    case 'event.owner_changed':
      return `${actor} đã đổi người phụ trách.`;
    case 'position.created':
      return `${actor} đã thêm vị trí ${p.name}.`;
    case 'position.updated':
      return `${actor} đã sửa vị trí ${await L.positionName(a.object_id)}.`;
    case 'position.removed':
      return `${actor} đã bỏ vị trí ${await L.positionName(a.object_id)}.`;
    case 'assignment.requested':
      return `${actor} đã xếp ${await L.userName(p.assignee_id)} vào ${await L.positionName(p.position_id)}.`;
    case 'assignment.accepted':
      return `${await L.userName(p.assignee_id)} đã nhận ${await L.positionName(p.position_id)}${p.responded_by !== p.assignee_id ? ` (${actor} xác nhận thay)` : ''}.`;
    case 'assignment.declined':
      return `${await L.userName(p.assignee_id)} đã từ chối ${await L.positionName(p.position_id)}${p.responded_by !== p.assignee_id ? ` (${actor} trả lời thay)` : ''}.`;
    case 'assignment.reconfirm_requested':
      return `${await L.userName(p.assignee_id)} cần xác nhận lại ${await L.positionName(p.position_id)}.`;
    case 'assignment.cancelled':
      return `${await L.userName(p.assignee_id)} không còn ở ${await L.positionName(p.position_id)} (${CANCEL_REASON[p.cancel_reason] ?? p.cancel_reason}).`;
    case 'group.member_added':
      return `${actor} đã thêm ${await L.userName(p.user_id)} vào nhóm.`;
    case 'group.member_removed':
      return p.by_self ? `${await L.userName(p.user_id)} đã rời nhóm.` : `${actor} đã gỡ ${await L.userName(p.user_id)} khỏi nhóm.`;
    case 'group.member_role_changed':
      return `${await L.userName(p.user_id)} giờ là ${p.after === 'leader' ? 'trưởng nhóm' : 'thành viên'}.`;
    case 'task.created':
      return `${actor} đã tạo việc.`;
    case 'task.assigned':
      return p.to_owner_id ? `${actor} đã giao việc cho ${await L.userName(p.to_owner_id)}.` : 'Việc chưa có người phụ trách.';
    case 'task.accepted':
      return `${actor} đã nhận việc.`;
    case 'task.declined':
      return `${actor} đã từ chối việc.`;
    case 'task.status_changed':
      return `${actor} đổi tiến độ: ${STATUS[p.after] ?? p.after}.`;
    case 'task.completed':
      return `${actor} đã hoàn thành việc.`;
    case 'task.reopened':
      return `${actor} đã mở lại việc.`;
    case 'task.cancelled':
      return `${actor} đã huỷ việc.`;
    case 'task.due_changed':
      return `Hạn việc đổi: ${when(p.before, tz) || 'không hạn'} → ${when(p.after, tz) || 'không hạn'}.`;
    case 'task.flag_changed':
      return `${actor} ${p.value ? 'bật' : 'tắt'} cờ ${p.flag === 'needs_help' ? '"cần giúp"' : '"bị chặn"'}.`;
    case 'task.collaborator_added':
      return `${actor} đã thêm ${await L.userName(p.user_id)} cùng làm.`;
    case 'task.collaborator_removed':
      return `${actor} đã bỏ ${await L.userName(p.user_id)} khỏi người cùng làm.`;
    case 'task.updated':
      return `${actor} đã sửa việc.`;
    default:
      return null;
  }
}

const STATUS: Record<string, string> = { open: 'chưa làm', in_progress: 'đang làm', done: 'xong', cancelled: 'đã huỷ' };

async function eventTitle(db: Queryable, eventId: string | null) {
  if (!eventId) return '';
  const r = await db.query<{ title: string }>(`select title from app.events where id = $1`, [eventId]);
  return r.rows[0] ? `"${r.rows[0].title}"` : '';
}

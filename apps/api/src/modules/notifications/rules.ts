import type { Facts } from './facts.js';
import type { Activity, AudienceRow, Reason, Target } from './types.js';

/**
 * Ma trận người nhận (NOTIFICATION_ENGINE §5). Mỗi verb → các dòng audience (chưa lọc actor/quyền xem).
 * Verb của lát sau (task.*, event.rescheduled…) đã có dòng ở đây để lát đó chỉ cần phát sự kiện.
 */
export async function audience(a: Activity, f: Facts): Promise<AudienceRow[]> {
  const p = a.payload;
  const direct = (userIds: Array<string | null | undefined>, reason: Reason): AudienceRow[] =>
    userIds.filter((u): u is string => Boolean(u)).map((userId) => ({ userId, cls: 'direct', reason }));
  const action = (userIds: Array<string | null | undefined>, reason: Reason): AudienceRow[] =>
    userIds.filter((u): u is string => Boolean(u)).map((userId) => ({ userId, cls: 'action_required', reason, needsAction: true }));
  const onBehalf = p.responded_by && p.responded_by !== p.assignee_id;
  const ev = a.event_id;

  switch (a.verb) {
    case 'member.role_changed':
    case 'group.member_added':
    case 'group.member_removed':
    case 'group.member_role_changed':
      return direct([p.user_id], 'target_user');

    case 'event.published':
      return direct(await f.eventOwners(ev!), 'event_owner');
    case 'event.updated':
      return [
        ...direct(await f.eventOwners(ev!), 'event_owner'),
        ...direct(await f.subscribers('event', ev!), 'subscriber'),
        ...(p.notify_assignees ? direct(await f.activeAssignees(ev!), 'assignee') : []),
      ];
    case 'event.rescheduled':
      // Người phải xác nhận lại nhận "Cần bạn" qua sự kiện con; ở đây là người vẫn accepted/requested (gộp nhờ khoá gốc).
      return [
        ...direct(await f.activeAssignees(ev!), 'assignee'),
        ...direct(await f.eventOwners(ev!), 'event_owner'),
        ...direct(await f.subscribers('event', ev!), 'subscriber'),
      ];
    case 'event.relocated':
      return [
        ...direct(await f.activeAssignees(ev!), 'assignee'),
        ...direct(await f.eventOwners(ev!), 'event_owner'),
        ...direct(await f.subscribers('event', ev!), 'subscriber'),
      ];
    case 'event.cancelled':
      return [
        ...direct((p.active_assignee_ids as string[] | undefined) ?? [], 'assignee'),
        ...direct(await f.eventOwners(ev!), 'event_owner'),
        ...direct(await f.subscribers('event', ev!), 'subscriber'),
        ...direct((p.task_owner_ids as string[] | undefined) ?? [], 'task_owner'),
      ];
    case 'event.owner_changed':
      return direct([...((p.added as string[]) ?? []), ...((p.removed as string[]) ?? [])], 'target_user');

    case 'assignment.requested':
    case 'assignment.reconfirm_requested':
      return action([p.assignee_id], 'assignee');
    case 'assignment.accepted':
      return onBehalf ? direct([p.assignee_id], 'target_user') : [];
    case 'assignment.declined':
      return [...action(await f.positionManagers(p.position_id), 'position_manager'), ...(onBehalf ? direct([p.assignee_id], 'target_user') : [])];
    case 'assignment.cancelled':
      if (p.cancel_reason === 'event_cancelled') return []; // gộp vào event.cancelled
      if (p.cancel_reason === 'member_left') return action(await f.positionManagers(p.position_id), 'position_manager');
      return direct([p.assignee_id], 'assignee');

    case 'task.assigned': {
      if (!p.to_owner_id) return action([p.assigned_by ?? (await f.task(a.object_id))?.assigned_by], 'assigned_by');
      return [...action([p.to_owner_id], 'task_owner'), ...direct([p.from_owner_id], 'target_user')];
    }
    case 'task.accepted':
      return direct([(await f.task(a.object_id))?.assigned_by], 'assigned_by');
    case 'task.declined':
      return action([(await f.task(a.object_id))?.assigned_by], 'assigned_by');
    case 'task.status_changed':
    case 'task.updated':
      return direct(await f.subscribers('task', a.object_id), 'subscriber');
    case 'task.completed': {
      const t = await f.task(a.object_id);
      return [
        ...direct([t?.assigned_by], 'assigned_by'),
        ...direct(await f.taskCollaborators(a.object_id), 'collaborator'),
        ...direct(await f.subscribers('task', a.object_id), 'subscriber'),
      ];
    }
    case 'task.reopened':
    case 'task.due_changed':
      return [...direct([(await f.task(a.object_id))?.owner_id], 'task_owner'), ...direct(await f.subscribers('task', a.object_id), 'subscriber')];
    case 'task.cancelled':
      return [
        ...direct([(await f.task(a.object_id))?.owner_id], 'task_owner'),
        ...direct(await f.taskCollaborators(a.object_id), 'collaborator'),
        ...direct(await f.subscribers('task', a.object_id), 'subscriber'),
      ];
    case 'task.flag_changed': {
      if (!p.value) return [];
      const t = await f.task(a.object_id);
      return [
        ...direct([t?.assigned_by], 'assigned_by'),
        ...(t?.event_id ? direct(await f.eventOwners(t.event_id), 'event_owner') : []),
        ...(p.flag === 'needs_help' ? direct(await f.taskCollaborators(a.object_id), 'collaborator') : []),
      ];
    }
    case 'task.collaborator_added':
    case 'task.collaborator_removed':
      return direct([p.user_id], 'target_user');

    case 'message.created':
      return [...direct((p.mention_ids as string[]) ?? [], 'mentioned'), ...direct([p.reply_to_sender_id], 'replied')];
    case 'message.edited':
      return direct((p.added_mention_ids as string[]) ?? [], 'mentioned');
    case 'attachment.added':
    case 'attachment.removed':
      // payload.owner{type, id} (EVENT_API_CONTRACTS §2.4).
      if (a.task_id && (p.owner as { type?: string } | undefined)?.type === 'task') return direct(await f.subscribers('task', a.task_id), 'subscriber');
      if (a.event_id && (p.owner as { type?: string } | undefined)?.type === 'event') return direct(await f.subscribers('event', a.event_id), 'subscriber');
      return [];
    default:
      return [];
  }
}

/** Đối tượng mở ra khi chạm vào bản ghi (notifications.object_*). */
export function targetOf(a: Activity): Target | null {
  const [domain] = a.verb.split('.');
  if ((domain === 'event' || domain === 'position' || domain === 'assignment') && a.event_id) return { type: 'event', id: a.event_id };
  if (domain === 'task') return { type: 'task', id: a.object_id };
  if (domain === 'message') return { type: 'message', id: a.object_id };
  if (domain === 'group') return { type: 'group', id: a.object_id };
  if (domain === 'member') return { type: 'organization', id: a.org_id };
  if (domain === 'attachment') return a.task_id ? { type: 'task', id: a.task_id } : a.event_id ? { type: 'event', id: a.event_id } : null;
  return null;
}

/** Đối tượng của mục (notification_items.object_*): thứ mà hành động "giải quyết" nhắm tới. */
export function itemObject(a: Activity): { type: string; id: string } {
  if ((a.verb === 'assignment.declined' || (a.verb === 'assignment.cancelled' && a.payload.cancel_reason === 'member_left')) && a.payload.position_id) {
    return { type: 'position', id: a.payload.position_id }; // lấp vị trí: giải quyết khi Position đủ người
  }
  return { type: a.object_type, id: a.object_id };
}

/** Gộp theo thời gian (§8.2). */
export function familyOf(verb: string): string | null {
  if (verb === 'event.updated' || verb === 'event.rescheduled' || verb === 'event.relocated') return 'event.change';
  if (verb === 'assignment.requested' || verb === 'assignment.reconfirm_requested') return 'assignment.request';
  if (verb === 'task.updated' || verb === 'task.due_changed' || verb === 'task.status_changed' || verb === 'task.flag_changed') return 'task.change';
  return null;
}

export const COALESCE_WINDOW_MIN = 10;

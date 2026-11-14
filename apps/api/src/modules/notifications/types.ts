/** Một dòng activity_events như notifier đọc (EVENT_API_CONTRACTS §1). */
export interface Activity {
  id: string;
  seq: string;
  org_id: string;
  verb: string;
  actor_type: 'user' | 'system';
  actor_id: string | null;
  object_type: string;
  object_id: string;
  event_id: string | null;
  task_id: string | null;
  group_id: string | null;
  conversation_id: string | null;
  cause_id: string | null;
  payload: Record<string, any>;
  occurred_at: Date;
}

export type NotificationClass = 'action_required' | 'direct';

/** Lý do audience (NOTIFICATION_ENGINE §6). Trách nhiệm không bị mute loại bỏ. */
export type Reason =
  | 'assignee'
  | 'position_manager'
  | 'task_owner'
  | 'assigned_by'
  | 'collaborator'
  | 'event_owner'
  | 'target_user'
  | 'subscriber'
  | 'mentioned'
  | 'replied';

export const INTEREST_REASONS: ReadonlySet<Reason> = new Set(['subscriber', 'mentioned', 'replied']);

/** Một dòng audience trước khi khử trùng: ai, lớp nào, vì sao, có cần hành động không. */
export interface AudienceRow {
  userId: string;
  cls: NotificationClass;
  reason: Reason;
  needsAction?: boolean;
}

export interface Target {
  type: 'event' | 'task' | 'message' | 'group' | 'organization';
  id: string;
}

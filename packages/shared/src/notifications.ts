export type NotificationClass = 'action_required' | 'direct';
export type ActionState = 'none' | 'pending' | 'done' | 'superseded';

export interface NotificationDto {
  id: string;
  class: NotificationClass;
  actionState: ActionState;
  reasons: string[];
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
  target: { type: 'event' | 'task' | 'message' | 'group' | 'organization'; id: string };
  /** false: người nhận đã mất quyền xem; title/lines bị che (F11-T11). */
  available: boolean;
  title: string | null;
  subtitle: string | null;
  /** Câu dựng khi xem từ trạng thái hiện tại; không chứa nội dung tin nhắn hay lý do từ chối. */
  lines: string[];
  link: { route: 'event' | 'group' | 'org' | 'task'; id: string } | null;
  /** Assignment còn chờ người nhận trả lời (để nút Nhận/Từ chối ngay trong hộp thông báo). */
  pendingAssignments: Array<{ id: string; status: 'requested' | 'reconfirm' }>;
}

export interface NotificationCountsDto {
  unreadCount: number;
  pendingCount: number;
}

export interface NotificationPageDto extends NotificationCountsDto {
  items: NotificationDto[];
  nextBefore: string | null;
}

export type SubscriptionMode = 'follow' | 'mute' | 'all' | 'mentions';

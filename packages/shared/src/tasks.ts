import type { TaskSourceDto } from './context.js';

export type TaskScopeType = 'event' | 'group' | 'private';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskAcceptance = 'none' | 'pending' | 'accepted' | 'declined';

export interface TaskPersonDto {
  userId: string;
  displayName: string;
}

/** Task (DATA_MODEL §3.4) kèm quyền của người xem để giao diện ẩn/hiện nút (PERMISSION_MODEL §4.6). */
export interface TaskDto {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  scope: { type: TaskScopeType; id: string | null; name: string | null };
  owner: TaskPersonDto | null;
  assignedBy: TaskPersonDto | null;
  createdBy: TaskPersonDto;
  collaborators: TaskPersonDto[];
  requiresAcceptance: boolean;
  acceptance: TaskAcceptance;
  /** Chỉ người giao, người phụ trách và người quản lý thấy (như decline_reason của Assignment). */
  declineReason: string | null;
  status: TaskStatus;
  blocked: boolean;
  needsHelp: boolean;
  dueAt: string | null;
  /** Hạn tương đối so với giờ bắt đầu buổi (phút); chỉ Task của buổi. */
  dueOffsetMin: number | null;
  overdue: boolean;
  completedAt: string | null;
  conversationId: string | null;
  /** Task tạo từ tin nhắn (F10-T1, T2, T5); null nếu không tạo từ tin nhắn. */
  source: TaskSourceDto | null;
  version: number;
  can: { edit: boolean; assign: boolean; respond: boolean; status: boolean; reopenCancel: boolean; flag: boolean; collaborators: boolean };
}

/** Một dòng trong danh sách Task (của buổi, của nhóm, của tôi). */
export interface TaskSummaryDto {
  id: string;
  title: string;
  scope: { type: TaskScopeType; id: string | null; name: string | null };
  owner: TaskPersonDto | null;
  acceptance: TaskAcceptance;
  status: TaskStatus;
  blocked: boolean;
  needsHelp: boolean;
  dueAt: string | null;
  overdue: boolean;
}

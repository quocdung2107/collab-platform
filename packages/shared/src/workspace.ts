import type { AssignmentStatus } from './scheduling.js';
import type { NotificationDto } from './notifications.js';

/** Một vị trí của tôi trong một buổi. */
export interface WorkspaceAssignmentDto {
  kind: 'assignment';
  id: string;
  status: AssignmentStatus;
  orgId: string;
  orgName: string;
  eventId: string;
  eventTitle: string;
  startsAt: string;
  location: string | null;
  positionName: string;
  groupName: string | null;
  /** Giờ có mặt = starts_at + report_offset_min (F12-T3). */
  reportAt: string;
}

/** Việc của tôi (S10). */
export interface WorkspaceTaskDto {
  kind: 'task';
  id: string;
  orgId: string;
  orgName: string;
  title: string;
  status: 'open' | 'in_progress';
  acceptance: 'none' | 'pending' | 'accepted' | 'declined';
  dueAt: string | null;
  overdue: boolean;
  scope: { type: 'event' | 'group' | 'private'; id: string | null; name: string | null };
}

export interface ShortPositionDto {
  eventId: string;
  eventTitle: string;
  /** Bản nháp chưa gửi cho ai: vẫn cần xếp người nhưng khác "cần thay gấp". */
  eventStatus: 'draft' | 'published';
  startsAt: string;
  orgName: string;
  positionId: string;
  positionName: string;
  groupName: string | null;
  slots: number;
  filled: number;
}

export interface DeclinedTaskDto {
  id: string;
  title: string;
  orgName: string;
  declinedBy: string;
}

/**
 * My Workspace (UX_ARCHITECTURE §4.1, F12). Đọc trực tiếp từ bảng nghiệp vụ, không từ notifications
 * (trừ khối "Có gì mới").
 */
export interface WorkspaceDto {
  needsResponse: Array<WorkspaceAssignmentDto | WorkspaceTaskDto>;
  upcoming: Array<WorkspaceAssignmentDto | WorkspaceTaskDto>;
  news: NotificationDto[];
  /** Chỉ có khi người dùng điều phối gì đó. */
  coordinate: { shortPositions: ShortPositionDto[]; declinedTasks: DeclinedTaskDto[] } | null;
  /** Tổ chức đầu tiên của người dùng để trạng thái rỗng dẫn tới Lịch (F12-T5). */
  firstOrgId: string | null;
}

/** Ngày bận (AD-34): chỉ chủ sở hữu đọc được; không có lý do. */
export interface UnavailabilityDto {
  id: string;
  orgId: string;
  startsOn: string;
  endsOn: string;
}

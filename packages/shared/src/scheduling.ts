export type EventStatus = 'draft' | 'published' | 'cancelled';
export type EventVisibility = 'org' | 'groups';
export type AssignmentStatus = 'draft' | 'requested' | 'accepted' | 'declined' | 'reconfirm' | 'cancelled';

export interface AssignmentDto {
  id: string;
  userId: string;
  displayName: string;
  status: AssignmentStatus;
  /** Chỉ người được xếp và position_manager thấy (PERMISSION_MODEL §3); người khác nhận null. */
  declineReason: string | null;
  requestedAt: string | null;
  respondedAt: string | null;
  respondedBy: string | null;
  version: number;
}

export interface PositionDto {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  slots: number;
  reportOffsetMin: number;
  sort: number;
  version: number;
  /** Assignment đang chiếm chỗ: draft, requested, accepted, reconfirm. */
  filled: number;
  canManage: boolean;
  assignments: AssignmentDto[];
}

export interface EventDto {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  visibility: EventVisibility;
  templateId: string | null;
  copiedFrom: string | null;
  groups: Array<{ id: string; name: string }>;
  owners: Array<{ userId: string; displayName: string }>;
  publishedAt: string | null;
  version: number;
  canEdit: boolean;
  /** Có quyền tạo Position (org admin, event_owner, hoặc leader của một nhóm trong event_groups). */
  canAddPositions: boolean;
  conversationId: string | null;
  positions: PositionDto[];
}

export interface EventSummaryDto {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  status: EventStatus;
  /** Mẫu đã dùng khi tạo; lập lịch nhiều cấp gom buổi theo mẫu (IN-53). */
  templateId: string | null;
  groups: Array<{ id: string; name: string }>;
  slotsTotal: number;
  slotsFilled: number;
  myAssignments: Array<{ id: string; positionName: string; status: AssignmentStatus; reportAt: string }>;
  canEdit: boolean;
}

export interface CreatedEventDto {
  event: EventDto;
  /** Ví dụ: nhóm trong mẫu đã lưu trữ nên bị bỏ qua (F3-T6). */
  warnings: Array<{ code: 'archived_group_skipped' | 'member_skipped'; detail: string }>;
}

export interface CreatedAssignmentDto {
  assignment: AssignmentDto;
  warnings: Array<{ code: 'overlapping_assignment'; eventId: string; title: string; startsAt: string }>;
}

export interface TemplateDefinition {
  durationMin: number;
  groupIds: string[];
  positions: Array<{ name: string; groupId: string | null; slots: number; reportOffsetMin: number }>;
  /** Task mẫu; dueOffsetMin so với giờ bắt đầu buổi (null = không hạn). */
  tasks: Array<{ title: string; dueOffsetMin: number | null }>;
}

export interface EventTemplateDto {
  id: string;
  name: string;
  definition: TemplateDefinition;
  version: number;
}

/** Kết quả trả lời/gỡ: Event null nếu người gọi không còn xem được (vd. từ chối ở buổi chỉ nhóm thấy). */
export interface AssignmentResultDto {
  assignmentId: string;
  status: AssignmentStatus;
  event: EventDto | null;
}

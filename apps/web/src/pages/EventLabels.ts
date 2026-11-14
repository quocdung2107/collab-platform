import type { AssignmentStatus, EventStatus } from '@collab/shared';

export const eventStatusLabel: Record<EventStatus, string> = { draft: 'Bản nháp', published: 'Đã công bố', cancelled: 'Đã huỷ' };
export const assignmentStatusLabel: Record<AssignmentStatus, string> = {
  draft: 'Nháp (chưa gửi)',
  requested: 'Chờ xác nhận',
  accepted: 'Đã nhận',
  declined: 'Từ chối',
  reconfirm: 'Cần xác nhận lại',
  cancelled: 'Đã huỷ',
};

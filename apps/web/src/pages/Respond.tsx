import type { AssignmentStatus } from '@collab/shared';
import { api } from '../lib/api';
import { useAction } from '../lib/useLoad';

/**
 * Nút Nhận / Từ chối dùng chung (F5-T1: từ hộp thông báo, trang buổi, Hôm nay → cùng một lệnh).
 * onBehalf: người điều phối trả lời hộ (ghi "X xác nhận thay").
 */
export function RespondButtons({
  assignmentId,
  status,
  onDone,
  onBehalf = false,
}: {
  assignmentId: string;
  status: AssignmentStatus;
  onDone: () => void;
  onBehalf?: boolean;
}) {
  const act = useAction();
  const canAccept = status === 'requested' || status === 'reconfirm';
  const canDecline = canAccept || status === 'accepted';
  if (!canDecline) return null;
  const respond = (response: 'accept' | 'decline') => {
    let reason: string | undefined;
    if (response === 'decline') {
      reason = window.prompt(onBehalf ? 'Lý do từ chối (chỉ người điều phối và người được xếp thấy)' : 'Lý do bạn không tham gia được? (chỉ người điều phối thấy)') ?? undefined;
      if (!reason?.trim()) return;
    }
    void act.run(() => api.respondAssignment(assignmentId, { response, reason, expectedStatus: status }), onDone);
  };
  return (
    <span className="row">
      {canAccept && (
        <button className="button small primary" disabled={act.busy} onClick={() => respond('accept')}>
          {onBehalf ? 'Nhận hộ' : status === 'reconfirm' ? 'Xác nhận lại' : 'Nhận'}
        </button>
      )}
      <button className="button small" disabled={act.busy} onClick={() => respond('decline')}>
        {onBehalf ? 'Từ chối hộ' : 'Từ chối'}
      </button>
      {act.error && <span className="error">{act.error}</span>}
    </span>
  );
}

import type { AssignmentStatus } from '@collab/shared';
import { api } from '../lib/api';
import { useAction } from '@collab/client';
import { dialogs } from '../ui/dialogs';

/**
 * Nút Nhận / Từ chối dùng chung (F5-T1: từ hộp thông báo, trang buổi, Hôm nay → cùng một lệnh).
 * onBehalf: người điều phối trả lời hộ (ghi "X xác nhận thay").
 */
export function RespondButtons({
  assignmentId,
  status,
  onDone,
  onBehalf = false,
  large = false,
}: {
  assignmentId: string;
  status: AssignmentStatus;
  onDone: () => void;
  onBehalf?: boolean;
  /** Hai nút to chia đôi chiều ngang (Việc của tôi, băng "Vị trí của bạn"). */
  large?: boolean;
}) {
  const act = useAction();
  const canAccept = status === 'requested' || status === 'reconfirm';
  const canDecline = canAccept || status === 'accepted';
  if (!canDecline) return null;
  const respond = async (response: 'accept' | 'decline') => {
    let reason: string | undefined;
    if (response === 'decline') {
      const r = await dialogs.prompt({
        title: onBehalf ? 'Từ chối hộ' : status === 'accepted' ? 'Bạn không tham gia được nữa?' : 'Từ chối vị trí này?',
        message: onBehalf ? 'Lý do: chỉ người điều phối và người được xếp thấy.' : 'Lý do: chỉ người điều phối thấy.',
        suggestions: onBehalf ? undefined : ['Tôi bận việc gia đình', 'Tôi không khoẻ', 'Tôi đi vắng'],
        placeholder: 'Lý do',
        required: true,
        confirmLabel: 'Từ chối',
        danger: true,
      });
      if (!r?.trim()) return;
      reason = r.trim();
    }
    void act.run(() => api.respondAssignment(assignmentId, { response, reason, expectedStatus: status }), onDone);
  };
  const size = large ? 'button' : 'button small';
  return (
    <span className={large ? 'respond large' : 'row'}>
      <button className={size} disabled={act.busy} onClick={() => void respond('decline')}>
        {onBehalf ? 'Từ chối hộ' : status === 'accepted' ? 'Không tham gia được' : 'Từ chối'}
      </button>
      {canAccept && (
        <button className={`${size} primary`} disabled={act.busy} onClick={() => void respond('accept')}>
          {onBehalf ? 'Nhận hộ' : status === 'reconfirm' ? 'Xác nhận lại' : 'Nhận'}
        </button>
      )}
      {act.error && <span className="error">{act.error}</span>}
    </span>
  );
}

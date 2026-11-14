import { AppError } from '../../http/errors.js';
import type { Decision } from './can.js';

/** Chuyển quyết định của can() thành lỗi API: not_found khi không được xem (AD-12), forbidden khi xem được nhưng không được làm. */
export function assertAllowed(decision: Decision): void {
  if (decision.allowed) return;
  if (decision.deny === 'not_found') throw new AppError('not_found', 'Nội dung không khả dụng');
  if (decision.deny === 'read_only') throw new AppError('read_only', 'Hội thoại đã khoá, chỉ xem được');
  throw new AppError('forbidden', 'Bạn không có quyền thực hiện thao tác này');
}

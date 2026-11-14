import { AppError } from '../../http/errors.js';
import type { Decision } from './can.js';

/** Chuyển quyết định của can() thành lỗi API: not_found khi không được xem (AD-12), forbidden khi xem được nhưng không được làm. */
export function assertAllowed(decision: Decision): void {
  if (decision.allowed) return;
  if (decision.deny === 'not_found') throw new AppError('not_found', 'Nội dung không khả dụng');
  throw new AppError('forbidden', 'Bạn không có quyền thực hiện thao tác này');
}

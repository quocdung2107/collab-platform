/** Mã lỗi API — EVENT_API_CONTRACTS §4. Dùng chung cho Backend và máy khách. */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'not_found',
  'forbidden',
  'version_conflict',
  'state_conflict',
  'invalid_transition',
  'position_full',
  'duplicate_assignment',
  'not_a_member',
  'read_only',
  'rate_limited',
  /** Dịch vụ phụ thuộc chưa cấu hình / không sẵn sàng (vd. Storage chưa có khoá). */
  'unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode | 'internal';
    message: string;
    fields?: Record<string, string>;
    current?: unknown;
  };
}

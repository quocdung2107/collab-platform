import type { z } from 'zod';
import { UUID_RE } from '../lib/text.js';
import { AppError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
  throw new AppError('validation_failed', 'Dữ liệu không hợp lệ', { fields });
}

/** Tham số định danh sai định dạng được coi như không tồn tại (AD-12), không lộ lỗi cú pháp. */
export function idParam(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) throw notFound();
  return value.toLowerCase();
}

export const notFound = () => new AppError('not_found', 'Nội dung không khả dụng');

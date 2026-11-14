import { api, type UploadedFile } from './api';
import { supabase } from './supabase';

/**
 * Tải tệp lên (F9b): xin URL ký từ Backend (kiểm tra thành viên, kích thước) → tải thẳng lên Storage
 * bằng token đó → trả khoá để gắn vào tin/buổi/việc. Bucket riêng tư, không cần quyền Storage của người dùng.
 */
export async function uploadFile(orgId: string, file: File): Promise<UploadedFile> {
  const u = await api.requestUpload(orgId, { filename: file.name, size: file.size });
  const { error } = await supabase.storage.from('attachments').uploadToSignedUrl(u.key, u.token, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(`Tải tệp thất bại: ${error.message}`);
  return { key: u.key, filename: file.name };
}

/** Mở tệp: xin URL ngắn hạn mỗi lần mở (F14-T4). */
export async function openAttachment(id: string) {
  const w = window.open('', '_blank');
  const { url } = await api.attachmentUrl(id);
  if (w) w.location.href = url;
  else window.location.href = url;
}

export const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

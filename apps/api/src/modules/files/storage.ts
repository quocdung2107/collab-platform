import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';

/**
 * Adapter Storage (AD-29): mã nghiệp vụ không gọi SDK nhà cung cấp. Bucket riêng tư; chỉ Backend ký URL
 * (DATA_MODEL §8: quyền tải qua can(), URL ngắn hạn).
 */
export interface FileStorage {
  /** URL + token để máy khách tải lên đúng khoá này (không cần quyền Storage riêng). */
  signUpload(key: string): Promise<{ url: string; token: string }>;
  /** URL tải xuống hết hạn sau ttlSec giây (F14-T4). */
  signDownload(key: string, ttlSec: number, filename: string): Promise<string>;
  /** Kích thước/kiểu thật của đối tượng đã tải lên; null nếu chưa có. */
  stat(key: string): Promise<{ size: number; mime: string | null } | null>;
}

export const BUCKET = 'attachments';
export const DOWNLOAD_TTL_SEC = 300;

const unavailable = () => new AppError('unavailable', 'Chưa bật lưu trữ tệp (thiếu khoá Storage trên máy chủ)');

export const disabledStorage: FileStorage = {
  signUpload: () => Promise.reject(unavailable()),
  signDownload: () => Promise.reject(unavailable()),
  stat: () => Promise.reject(unavailable()),
};

/**
 * Supabase Storage qua REST (đường dẫn như storage-js 2.x: POST /object/upload/sign/{bucket}/{path},
 * POST /object/sign/{bucket}/{path} {expiresIn}). stat đọc storage.objects bằng kết nối DB của Backend.
 */
export function supabaseStorage(supabaseUrl: string, serviceKey: string, db: Queryable): FileStorage {
  const base = `${supabaseUrl}/storage/v1`;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const path = (key: string) => `${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Storage ${r.status}: ${await r.text()}`);
    return (await r.json()) as Record<string, string>;
  };
  return {
    async signUpload(key) {
      const d = await post(`${base}/object/upload/sign/${path(key)}`, {});
      const url = new URL(base + d.url);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('Storage: không có token tải lên');
      return { url: url.toString(), token };
    },
    async signDownload(key, ttlSec, filename) {
      const d = await post(`${base}/object/sign/${path(key)}`, { expiresIn: ttlSec });
      return `${base}${d.signedURL}&download=${encodeURIComponent(filename)}`;
    },
    async stat(key) {
      const r = await db.query<{ size: string | null; mime: string | null }>(
        `select metadata->>'size' as size, metadata->>'mimetype' as mime from storage.objects where bucket_id = $1 and name = $2`,
        [BUCKET, key],
      );
      const o = r.rows[0];
      return o ? { size: Number(o.size ?? 0), mime: o.mime } : null;
    },
  };
}

/** Kiểm thử: đối tượng "tải lên" bằng put(); URL ký mang hạn để kiểm F14-T4. */
export class MemoryStorage implements FileStorage {
  readonly objects = new Map<string, { size: number; mime: string }>();
  put(key: string, size: number, mime: string) {
    this.objects.set(key, { size, mime });
  }
  async signUpload(key: string) {
    return { url: `memory://upload/${key}`, token: 'tok' };
  }
  async signDownload(key: string, ttlSec: number) {
    return `memory://download/${key}?exp=${Date.now() + ttlSec * 1000}`;
  }
  async stat(key: string) {
    return this.objects.get(key) ?? null;
  }
}

let current: FileStorage = disabledStorage;
/** Adapter đang dùng (buildApp đặt từ AppDeps; mặc định tắt). */
export const fileStorage = () => current;
export const setFileStorage = (s: FileStorage) => {
  current = s;
};

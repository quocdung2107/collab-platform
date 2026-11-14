import type { ApiErrorBody, MeResponse } from '@collab/shared';
import { supabase } from './supabase';

// Rỗng = bản build chưa có máy chủ API (vd. GitHub Pages trước khi host API). Chỉ dùng localhost khi chạy dev.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8080' : '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody['error'],
  ) {
    super(body.message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, { code: 'internal', message: 'Bản này chưa nối với máy chủ API. Đăng nhập Google đã thành công.' });
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? { code: 'internal', message: res.statusText });
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>('/v1/me'),
};

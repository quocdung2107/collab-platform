import { createApi } from '@collab/client';
import { supabase } from './supabase';

// Rỗng = bản build chưa có máy chủ API (vd. GitHub Pages trước khi host API). Chỉ dùng localhost khi chạy dev.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8080' : '');

/** Gắn lớp API dùng chung (packages/client) với cấu hình và phiên đăng nhập của trình duyệt. */
export const api = createApi({
  baseUrl: API_URL,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
});

export * from '@collab/client';

import { createClient } from '@supabase/supabase-js';

/**
 * Adapter Auth phía máy khách (AD-29). Máy khách CHỈ dùng Supabase để đăng nhập (và Realtime ở bước sau);
 * dữ liệu nghiệp vụ luôn đi qua API (AD-28).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

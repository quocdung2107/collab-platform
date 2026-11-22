import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from './config';
import { chunkedSecureStorage } from './secureStorage';

/**
 * Supabase trên app (AD-29): chỉ dùng cho đăng nhập và Realtime; dữ liệu nghiệp vụ đi qua API (AD-28).
 * PKCE + phiên trong SecureStore; tự làm mới token chỉ khi app đang mở (khuyến nghị của Supabase cho RN).
 */
export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    flowType: 'pkce',
    storage: chunkedSecureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

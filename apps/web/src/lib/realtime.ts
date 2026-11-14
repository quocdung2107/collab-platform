import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Nghe tín hiệu realtime (AD-31): kênh riêng tư `user:{id}` và các `group:{id}` đang xem.
 * Tín hiệu không mang nội dung (AD-10) → chỉ báo "có thay đổi", trang tự tải lại qua API.
 * `access_changed`: làm mới JWT rồi setAuth để Realtime đánh giá lại quyền vào kênh.
 */
export function useRealtime(topics: string[], onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = topics.join('|');

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    const channels = key.split('|').map((topic) =>
      supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'access_changed' }, async () => {
          const { data } = await supabase.auth.refreshSession();
          if (data.session) await supabase.realtime.setAuth(data.session.access_token);
          if (!disposed) cb.current();
        })
        .on('broadcast', { event: 'activity' }, () => !disposed && cb.current())
        .subscribe(),
    );
    void supabase.auth.getSession().then(({ data }) => data.session && supabase.realtime.setAuth(data.session.access_token));
    return () => {
      disposed = true;
      for (const c of channels) void supabase.removeChannel(c);
    };
  }, [key]);
}

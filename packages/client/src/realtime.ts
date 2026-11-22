import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';

/**
 * Nghe tín hiệu realtime (AD-31): kênh riêng tư `user:{id}`, `group:{id}`, `conversation:{id}` đang xem.
 * Tín hiệu không mang nội dung (AD-10) → chỉ báo "có thay đổi", màn hình tự tải lại qua API.
 * `access_changed`: làm mới JWT rồi setAuth để Realtime đánh giá lại quyền vào kênh.
 * Dùng chung cho web và app; mỗi nền tảng truyền Supabase client của mình.
 */
export function useRealtime(supabase: SupabaseClient, topics: string[], onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = topics.join('|');

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    const fire = () => !disposed && cb.current();
    const channels = key.split('|').map((topic) =>
      supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'access_changed' }, async () => {
          const { data } = await supabase.auth.refreshSession();
          if (data.session) await supabase.realtime.setAuth(data.session.access_token);
          fire();
        })
        .on('broadcast', { event: 'activity' }, fire)
        .on('broadcast', { event: 'conversation.message' }, fire)
        .on('broadcast', { event: 'conversation.message_changed' }, fire)
        .on('broadcast', { event: 'notification.created' }, fire)
        .on('broadcast', { event: 'notification.updated' }, fire)
        .subscribe(),
    );
    void supabase.auth.getSession().then(({ data }) => data.session && supabase.realtime.setAuth(data.session.access_token));
    return () => {
      disposed = true;
      for (const c of channels) void supabase.removeChannel(c);
    };
  }, [supabase, key]);
}

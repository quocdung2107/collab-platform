import { useEffect, useSyncExternalStore } from 'react';

/**
 * Tiêu đề thanh trên do màn hình con đặt (tên buổi, tên nhóm…), như ứng dụng iOS.
 * href: chạm vào tiêu đề để mở đối tượng (vd. từ hội thoại mở nhóm/buổi/việc).
 */
export interface ScreenTitle {
  title: string;
  subtitle?: string;
  href?: string;
}

let current: ScreenTitle | null = null;
const listeners = new Set<() => void>();
const set = (t: ScreenTitle | null) => {
  current = t;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => current;

export function useScreenTitle() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Đặt tiêu đề khi có dữ liệu; tự xoá khi rời màn hình. */
export function useSetTitle(t: ScreenTitle | null) {
  const key = t ? `${t.title}|${t.subtitle ?? ''}|${t.href ?? ''}` : '';
  useEffect(() => {
    if (!t) return;
    set(t);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

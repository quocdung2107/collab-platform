import { useLayoutEffect } from 'react';
import { lastNavDirection, savedScroll } from '../lib/route';

/**
 * Quay lại một màn hình → về đúng vị trí cuộn cũ (UX §2 quy tắc 2); đi tới → lên đầu.
 * Dữ liệu tải lại sau khi gắn màn hình nên thử vài nhịp tới khi trang đủ cao.
 */
export function useScrollRestore(key: string) {
  useLayoutEffect(() => {
    const y = lastNavDirection() === 'back' ? (savedScroll(key) ?? 0) : 0;
    window.scrollTo(0, y);
    if (y === 0 || Math.abs(window.scrollY - y) <= 4) return;
    // Dừng khi đã tới nơi hoặc người dùng tự cuộn/chạm.
    let done = false;
    const stop = () => (done = true);
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    window.addEventListener('wheel', stop, { once: true, passive: true });
    const timers = [80, 200, 450, 900].map((ms) =>
      window.setTimeout(() => {
        if (done) return;
        if (document.documentElement.scrollHeight - window.innerHeight >= y) {
          window.scrollTo(0, y);
          done = true;
        }
      }, ms),
    );
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('wheel', stop);
    };
  }, [key]);
}

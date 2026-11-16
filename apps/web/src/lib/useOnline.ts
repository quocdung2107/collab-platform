import { useEffect, useState } from 'react';

/** Trạng thái mạng của trình duyệt. `navigator.onLine` = false là chắc chắn mất mạng; true chỉ là "có thể". */
export function useOnline(): { online: boolean; backAt: number } {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [backAt, setBackAt] = useState(0);
  useEffect(() => {
    const on = () => {
      setOnline(true);
      setBackAt(Date.now());
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return { online, backAt };
}

import { useEffect, useState } from 'react';

/**
 * Định tuyến bằng hash để chạy được trên GitHub Pages (không có rewrite phía máy chủ).
 * #org=<id> · #group=<id> · #invite=<token> · #od17
 */
export type Route =
  | { name: 'home' }
  | { name: 'org'; id: string }
  | { name: 'group'; id: string }
  | { name: 'invite'; token: string }
  | { name: 'od17' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === 'od17') return { name: 'od17' };
  const [k, v] = h.split('=', 2);
  if (v && k === 'org') return { name: 'org', id: v };
  if (v && k === 'group') return { name: 'group', id: v };
  if (v && k === 'invite') return { name: 'invite', token: v };
  return { name: 'home' };
}

export const href = (r: Route) =>
  r.name === 'home' ? '#' : r.name === 'od17' ? '#od17' : r.name === 'invite' ? `#invite=${r.token}` : `#${r.name}=${r.id}`;

export const go = (r: Route) => {
  window.location.hash = href(r);
};

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Liên kết mời mất hash qua vòng chuyển hướng OAuth → giữ tạm token để mở lại sau khi đăng nhập. */
const PENDING = 'collab.pendingInvite';
export const pendingInvite = {
  save(token: string) {
    try {
      localStorage.setItem(PENDING, token);
    } catch {
      /* bộ nhớ bị chặn: người dùng mở lại liên kết là được */
    }
  },
  take(): string | null {
    try {
      const t = localStorage.getItem(PENDING);
      localStorage.removeItem(PENDING);
      return t;
    } catch {
      return null;
    }
  },
};

import { useEffect, useState } from 'react';

/**
 * Định tuyến bằng hash để chạy được trên GitHub Pages (không có rewrite phía máy chủ).
 * #org=<id> · #group=<id> · #event=<id> · #task=<id> · #newevent=<orgId> · #invite=<token> · #od17
 */
export type Route =
  | { name: 'home' }
  | { name: 'org'; id: string }
  | { name: 'group'; id: string }
  | { name: 'event'; id: string }
  | { name: 'task'; id: string }
  /** Tạo Event trong tổ chức id; copy = Event nguồn khi "sao chép buổi trước". */
  | { name: 'newevent'; id: string; copy?: string }
  | { name: 'invite'; token: string }
  | { name: 'inbox' }
  | { name: 'od17' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === 'od17') return { name: 'od17' };
  if (h === 'inbox') return { name: 'inbox' };
  // split('=', 2) của JS bỏ phần sau dấu '=' thứ hai → tách tại dấu '=' đầu tiên.
  const i = h.indexOf('=');
  const [k, v] = i < 0 ? [h, ''] : [h.slice(0, i), h.slice(i + 1)];
  if (v && k === 'org') return { name: 'org', id: v };
  if (v && k === 'group') return { name: 'group', id: v };
  if (v && k === 'event') return { name: 'event', id: v };
  if (v && k === 'task') return { name: 'task', id: v };
  if (v && k === 'newevent') {
    const j = v.indexOf('&copy=');
    return j < 0 ? { name: 'newevent', id: v } : { name: 'newevent', id: v.slice(0, j), copy: v.slice(j + 6) };
  }
  if (v && k === 'invite') return { name: 'invite', token: v };
  return { name: 'home' };
}

export const href = (r: Route) =>
  r.name === 'newevent'
    ? `#newevent=${r.id}${r.copy ? `&copy=${r.copy}` : ''}`
    : r.name === 'home' ? '#' : r.name === 'od17' || r.name === 'inbox' ? `#${r.name}` : r.name === 'invite' ? `#invite=${r.token}` : `#${r.name}=${r.id}`;

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

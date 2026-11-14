import { useEffect, useState } from 'react';

/**
 * Định tuyến bằng hash để chạy được trên GitHub Pages (không có rewrite phía máy chủ).
 * #org=<id> · #group=<id> · #event=<id> · #task=<id> · #newevent=<orgId> · #invite=<token> · #inbox · #settings
 * Gốc của 4 tab (UX §2): # (Việc của tôi) · #calendar · #chats · #groups; menu cá nhân: #me
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
  | { name: 'settings' }
  | { name: 'calendar' }
  | { name: 'chats' }
  | { name: 'groups' }
  | { name: 'me' };

/** Tên tuyến không tham số (ngoài home). */
const SIMPLE = ['inbox', 'settings', 'calendar', 'chats', 'groups', 'me'] as const;
type Simple = (typeof SIMPLE)[number];
const isSimple = (h: string): h is Simple => (SIMPLE as readonly string[]).includes(h);

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (isSimple(h)) return { name: h };
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

export function href(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#';
    case 'newevent':
      return `#newevent=${r.id}${r.copy ? `&copy=${r.copy}` : ''}`;
    case 'invite':
      return `#invite=${r.token}`;
    case 'org':
    case 'group':
    case 'event':
    case 'task':
      return `#${r.name}=${r.id}`;
    default:
      return `#${r.name}`;
  }
}

export const go = (r: Route) => {
  window.location.hash = href(r);
};

/** 4 tab ở thanh dưới (UX §2). */
export type Tab = 'work' | 'calendar' | 'chats' | 'groups';

/** Tab sáng đèn cho một tuyến; null = màn hình ngoài tab (thông báo, cài đặt, menu cá nhân). */
export function tabOf(r: Route): Tab | null {
  switch (r.name) {
    case 'home':
    case 'task':
      return 'work';
    case 'calendar':
    case 'event':
    case 'newevent':
      return 'calendar';
    case 'chats':
      return 'chats';
    case 'groups':
    case 'group':
      return 'groups';
    default:
      return null;
  }
}

/** Màn hình gốc của tab: hiện tiêu đề lớn, không có nút quay lại. */
export const isTabRoot = (r: Route) => r.name === 'home' || r.name === 'calendar' || r.name === 'chats' || r.name === 'groups';

/** Nơi nút quay lại dẫn về khi không có lịch sử trong ứng dụng (mở thẳng từ thông báo đẩy, liên kết Zalo). */
export function parentOf(r: Route): Route {
  switch (r.name) {
    case 'event':
    case 'newevent':
      return { name: 'calendar' };
    case 'group':
      return { name: 'groups' };
    case 'org':
    case 'settings':
      return { name: 'me' };
    default:
      return { name: 'home' };
  }
}

/**
 * Lịch sử hash trong phiên này, để nút quay lại chỉ gọi history.back() khi trang trước vẫn thuộc ứng dụng.
 * Cử chỉ quay lại của hệ điều hành cũng phát hashchange: hash mới trùng mục kề trước → coi là lùi.
 */
export class HashTrail {
  private trail: string[];
  private replacing = false;
  constructor(start: string) {
    this.trail = [start];
  }
  /** Gọi ở mỗi hashchange. */
  visit(h: string) {
    if (this.replacing) {
      this.replacing = false;
      this.trail[this.trail.length - 1] = h;
    } else if (this.trail.length > 1 && this.trail[this.trail.length - 2] === h) this.trail.pop();
    else this.trail.push(h);
  }
  canGoBack() {
    return this.trail.length > 1;
  }
  /** Đánh dấu lần hashchange kế tiếp là location.replace. */
  willReplace() {
    this.replacing = true;
  }
}

const norm = (h: string) => (h === '' || h === '#' ? '#' : h);
const trail = typeof window !== 'undefined' ? new HashTrail(norm(window.location.hash)) : null;
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => trail?.visit(norm(window.location.hash)));

export function goBack(r: Route) {
  if (trail?.canGoBack()) window.history.back();
  else {
    trail?.willReplace();
    window.location.replace(href(parentOf(r)));
  }
}

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

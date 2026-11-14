import type { ReactNode } from 'react';
import { goBack, href, type Route, type Tab } from '../lib/route';
import { Icon, type IconName } from './icons';

const TABS: Array<{ tab: Tab; label: string; icon: IconName; route: Route }> = [
  { tab: 'work', label: 'Việc của tôi', icon: 'work', route: { name: 'home' } },
  { tab: 'calendar', label: 'Lịch', icon: 'calendar', route: { name: 'calendar' } },
  { tab: 'chats', label: 'Chat', icon: 'chats', route: { name: 'chats' } },
  { tab: 'groups', label: 'Nhóm', icon: 'groups', route: { name: 'groups' } },
];

const count = (n: number) => (n > 99 ? '99+' : String(n));

/** Thanh 4 tab ở đáy (UX §2, phụ lục AD-25). badges: số hiện trên từng tab. */
export function TabBar({ active, badges }: { active: Tab | null; badges: Partial<Record<Tab, number>> }) {
  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      {TABS.map((t) => {
        const n = badges[t.tab] ?? 0;
        return (
          <a key={t.tab} href={href(t.route)} className={t.tab === active ? 'tab on' : 'tab'} aria-current={t.tab === active ? 'page' : undefined}>
            <span className="tab-icon">
              <Icon name={t.icon} />
              {n > 0 && <span className="dot-count">{count(n)}</span>}
            </span>
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** Chuông + ảnh đại diện, ở góc phải thanh trên của mọi màn hình (UX §2). */
export function TopActions({ unread, pending, initials }: { unread: number; pending: number; initials: string }) {
  const n = pending || unread;
  return (
    <span className="top-actions">
      <a className="icon-button" href={href({ name: 'inbox' })} aria-label={n ? `Thông báo, ${n} mới` : 'Thông báo'}>
        <Icon name="bell" />
        {n > 0 && <span className={pending ? 'dot-count' : 'dot-count quiet'}>{count(n)}</span>}
      </a>
      <a className="avatar" href={href({ name: 'me' })} aria-label="Tài khoản của tôi">
        {initials}
      </a>
    </span>
  );
}

/** Đầu màn hình gốc của tab: tiêu đề lớn kiểu iOS; leading = bộ chọn tổ chức. */
export function LargeHeader({ title, leading, actions }: { title: string; leading?: ReactNode; actions: ReactNode }) {
  return (
    <header className="appbar large">
      <div className="appbar-row">
        <span className="appbar-leading">{leading}</span>
        {actions}
      </div>
      <h1 className="large-title">{title}</h1>
    </header>
  );
}

/** Đầu màn hình con: nút quay lại + tiêu đề giữa. */
export function NavHeader({ route, title, actions }: { route: Route; title: string; actions: ReactNode }) {
  return (
    <header className="appbar">
      <div className="appbar-row">
        <button className="back" onClick={() => goBack(route)} aria-label="Quay lại">
          <Icon name="back" />
          <span>Quay lại</span>
        </button>
        <span className="appbar-title">{title}</span>
        {actions}
      </div>
    </header>
  );
}

/** Chữ viết tắt cho ảnh đại diện: chữ đầu của hai từ cuối, hợp tên tiếng Việt ("Nguyễn Quốc Dũng" → "QD"). */
export function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return '?';
  const pick = w.slice(-2);
  return pick.map((x) => x.charAt(0).toUpperCase()).join('');
}

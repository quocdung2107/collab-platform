import type { NotificationDto, NotificationPageDto } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { go, href, type Route } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { RespondButtons } from './Respond';

const ago = (iso: string) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const routeOf = (n: NotificationDto): Route | null => {
  if (!n.link) return null;
  return n.link.route === 'org' ? { name: 'org', id: n.link.id } : n.link.route === 'group' ? { name: 'group', id: n.link.id } : n.link.route === 'event' ? { name: 'event', id: n.link.id } : null;
};

/** Hộp thông báo (F11): "Cần bạn" lên đầu, rồi "Nên biết". */
export function Inbox({ meId, onCounts }: { meId: string; onCounts: () => void }) {
  const [pendingOnly, setPendingOnly] = useState(false);
  const page = useLoad(() => api.notifications({ pending: pendingOnly }), [pendingOnly]);
  const [older, setOlder] = useState<NotificationDto[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const act = useAction();
  useRealtime([`user:${meId}`], () => (page.reload(), setOlder([]), setNext(undefined)));

  const data: NotificationPageDto | null = page.data;
  const items = [...(data?.items ?? []), ...older];
  const cursor = next === undefined ? data?.nextBefore : next;
  const pending = items.filter((n) => n.actionState === 'pending');
  const rest = items.filter((n) => n.actionState !== 'pending');

  const open = (n: NotificationDto) =>
    void act.run(
      () => api.readNotification(n.id),
      () => {
        onCounts();
        const r = routeOf(n);
        if (r) go(r);
        else page.reload();
      },
    );

  return (
    <section className="card">
      <a href={href({ name: 'home' })} className="hint">
        ← Trang chủ
      </a>
      <h1>Thông báo</h1>
      <div className="row">
        <label className="row hint">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => (setOlder([]), setNext(undefined), setPendingOnly(e.target.checked))} /> Chỉ mục cần bạn
        </label>
        <button className="button small" disabled={act.busy || !data?.unreadCount} onClick={() => void act.run(() => api.readAllNotifications(), () => (page.reload(), onCounts()))}>
          Đánh dấu đã đọc
        </button>
      </div>
      {page.error && <p className="error">{page.error}</p>}
      {act.error && <p className="error">{act.error}</p>}
      {pending.length > 0 && <h2>Cần bạn ({pending.length})</h2>}
      <ul className="list">{pending.map((n) => <Item key={n.id} n={n} onOpen={open} onChanged={() => (page.reload(), onCounts())} />)}</ul>
      {rest.length > 0 && <h2>Nên biết</h2>}
      <ul className="list">{rest.map((n) => <Item key={n.id} n={n} onOpen={open} onChanged={page.reload} />)}</ul>
      {data && items.length === 0 && <p className="hint">Chưa có thông báo nào.</p>}
      {cursor && (
        <button
          className="button small"
          disabled={act.busy}
          onClick={() => void act.run(() => api.notifications({ before: cursor, pending: pendingOnly }), (p) => (setOlder((o) => [...o, ...p.items]), setNext(p.nextBefore)))}
        >
          Xem cũ hơn
        </button>
      )}
    </section>
  );
}

function Item({ n, onOpen, onChanged }: { n: NotificationDto; onOpen: (n: NotificationDto) => void; onChanged: () => void }) {
  const state = n.actionState === 'done' ? 'Đã xử lý' : n.actionState === 'superseded' ? 'Không còn cần' : null;
  return (
    <li className={n.readAt ? 'notif' : 'notif unread'}>
      <button className="link notif-body" onClick={() => onOpen(n)}>
        <strong>{n.available ? n.title : 'Nội dung không còn khả dụng'}</strong>
        {n.subtitle && <span className="hint"> · {n.subtitle}</span>}
        {n.available &&
          n.lines.map((l, i) => (
            <span key={i} className="notif-line">
              {l}
            </span>
          ))}
      </button>
      <span className="grid">
        <span className="hint">
          {state ?? (n.actionState === 'pending' ? 'Cần bạn' : '')} {ago(n.updatedAt)}
        </span>
        {n.actionState === 'pending' &&
          n.pendingAssignments.map((a) => <RespondButtons key={a.id} assignmentId={a.id} status={a.status} onDone={onChanged} />)}
      </span>
    </li>
  );
}

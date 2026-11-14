import type { NotificationDto, NotificationPageDto } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { go, type Route } from '../lib/route';
import { Icon } from '../ui/icons';
import { Segmented, Skeleton } from '../ui/kit';
import { useAction, useLoad } from '../lib/useLoad';
import { RespondButtons } from './Respond';

const ago = (iso: string) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const routeOf = (n: NotificationDto): Route | null => {
  if (!n.link) return null;
  return n.link.route === 'org' ? { name: 'org', id: n.link.id } : n.link.route === 'group' ? { name: 'group', id: n.link.id } : n.link.route === 'event' ? { name: 'event', id: n.link.id } : { name: 'task', id: n.link.id };
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
    <>
      <div className="toolbar">
        <Segmented
          label="Lọc thông báo"
          value={pendingOnly ? 'pending' : 'all'}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'pending', label: `Cần bạn${data?.pendingCount ? ` (${data.pendingCount})` : ''}` },
          ]}
          onChange={(v) => (setOlder([]), setNext(undefined), setPendingOnly(v === 'pending'))}
        />
        <button className="button small" disabled={act.busy || !data?.unreadCount} onClick={() => void act.run(() => api.readAllNotifications(), () => (page.reload(), onCounts()))}>
          Đã đọc hết
        </button>
      </div>
      {page.error && <p className="error">{page.error}</p>}
      {act.error && <p className="error">{act.error}</p>}
      {!data && !page.error && <Skeleton rows={4} />}
      {pending.length > 0 && (
        <section className="card">
          <h2>Cần bạn ({pending.length})</h2>
          <ul className="list">{pending.map((n) => <Item key={n.id} n={n} onOpen={open} onChanged={() => (page.reload(), onCounts())} />)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <section className="card">
          <h2>Nên biết</h2>
          <ul className="list">{rest.map((n) => <Item key={n.id} n={n} onOpen={open} onChanged={page.reload} />)}</ul>
        </section>
      )}
      {data && items.length === 0 && (
        <section className="card empty-state">
          <Icon name="bell" size={40} />
          <p>{pendingOnly ? 'Không có việc nào đang chờ bạn.' : 'Chưa có thông báo nào.'}</p>
        </section>
      )}
      {cursor && (
        <button
          className="button"
          disabled={act.busy}
          onClick={() => void act.run(() => api.notifications({ before: cursor, pending: pendingOnly }), (p) => (setOlder((o) => [...o, ...p.items]), setNext(p.nextBefore)))}
        >
          Xem cũ hơn
        </button>
      )}
    </>
  );
}

function Item({ n, onOpen, onChanged }: { n: NotificationDto; onOpen: (n: NotificationDto) => void; onChanged: () => void }) {
  const state = n.actionState === 'done' ? 'Đã xử lý' : n.actionState === 'superseded' ? 'Đã có cập nhật mới hơn' : null;
  const icon = n.target.type === 'event' ? 'calendar' : n.target.type === 'task' ? 'work' : n.target.type === 'message' ? 'chats' : n.target.type === 'group' ? 'groups' : 'building';
  return (
    <li className={n.readAt ? 'notif item' : 'notif item unread'}>
      <button className="cell-link notif-body" onClick={() => onOpen(n)}>
        <span className={`leading-icon kind-${n.actionState === 'pending' ? 'warn' : n.target.type}`}>
          <Icon name={icon} size={18} />
        </span>
        <span className="grid">
          <strong>{n.available ? n.title : 'Nội dung không còn khả dụng'}</strong>
          {n.subtitle && <span className="hint">{n.subtitle}</span>}
          {n.available &&
            n.lines.map((l, i) => (
              <span key={i} className="notif-line">
                {l}
              </span>
            ))}
          <span className="hint small">
            {state ? `${state} · ` : ''}
            {ago(n.updatedAt)}
          </span>
        </span>
        {!n.readAt && <span className="unread-dot" aria-label="Chưa đọc" />}
      </button>
      {n.actionState === 'pending' && n.pendingAssignments.map((a) => <RespondButtons key={a.id} assignmentId={a.id} status={a.status} onDone={onChanged} large />)}
    </li>
  );
}

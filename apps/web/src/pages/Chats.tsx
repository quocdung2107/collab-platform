import type { ConversationSummaryDto } from '@collab/shared';
import { api } from '../lib/api';
import { shortDay, timeLabel } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { href, type Route } from '../lib/route';
import { useLoad } from '../lib/useLoad';

const KIND: Record<ConversationSummaryDto['anchor']['type'], string> = { group: 'Nhóm', event: 'Buổi', task: 'Việc' };
const target = (c: ConversationSummaryDto): Route =>
  c.anchor.type === 'group' ? { name: 'group', id: c.anchor.id } : c.anchor.type === 'event' ? { name: 'event', id: c.anchor.id } : { name: 'task', id: c.anchor.id };

/** Thời điểm tin cuối: hôm nay → giờ, ngày khác → ngày. */
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? timeLabel(iso) : shortDay(iso));

/** Tab Chat (UX §4.2a): mọi hội thoại đọc được trong tổ chức đang xem, mới hoạt động lên trước. */
export function Chats({ orgId, meId }: { orgId: string; meId: string }) {
  const convs = useLoad(() => api.conversations(orgId), [orgId]);
  useRealtime([`user:${meId}`], convs.reload);
  const list = [...(convs.data ?? [])].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

  if (convs.error) return <p className="error">{convs.error}</p>;
  if (!convs.data) return <p className="center">Đang tải…</p>;
  if (list.length === 0)
    return (
      <section className="card">
        <p className="hint">Chưa có cuộc trò chuyện nào. Khi bạn vào một nhóm, trò chuyện của nhóm sẽ hiện ở đây.</p>
      </section>
    );
  return (
    <section className="card flush">
      <ul className="list">
        {list.map((c) => (
          <li key={c.id}>
            <a className="cell-link" href={href(target(c))}>
              <span className="grid">
                <strong>{c.anchor.name}</strong>
                <span className="hint">
                  {KIND[c.anchor.type]}
                  {c.readOnly ? ' · chỉ đọc' : ''}
                  {c.lastMessageAt ? ` · ${when(c.lastMessageAt)}` : ''}
                </span>
              </span>
              {c.unreadCount > 0 && <span className="badge">{c.unreadCount}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

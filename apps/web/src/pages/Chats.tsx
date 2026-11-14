import type { ConversationSummaryDto } from '@collab/shared';
import { api } from '../lib/api';
import { shortDay, timeLabel } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { Icon } from '../ui/icons';
import { Skeleton } from '../ui/kit';
import { useLoad } from '../lib/useLoad';

const KIND: Record<ConversationSummaryDto['anchor']['type'], string> = { group: 'Nhóm', event: 'Buổi', task: 'Việc' };

/** Thời điểm tin cuối: hôm nay → giờ, ngày khác → ngày. */
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? timeLabel(iso) : shortDay(iso));

/** Tab Chat (UX §4.2a): mọi hội thoại đọc được trong tổ chức đang xem, mới hoạt động lên trước. */
export function Chats({ orgId, meId }: { orgId: string; meId: string }) {
  const convs = useLoad(() => api.conversations(orgId), [orgId]);
  useRealtime([`user:${meId}`], convs.reload);
  const list = [...(convs.data ?? [])].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

  if (convs.error) return <p className="error">{convs.error}</p>;
  if (!convs.data) return <Skeleton rows={5} />;
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
            <a className="cell-link" href={href({ name: 'chat', id: c.id })}>
              <span className={`leading-icon kind-${c.anchor.type}`}>
                <Icon name={c.anchor.type === 'group' ? 'groups' : c.anchor.type === 'event' ? 'calendar' : 'work'} size={18} />
              </span>
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

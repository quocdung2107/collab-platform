import type { ConversationSummaryDto } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { href, type Route } from '../lib/route';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { useSetTitle } from '../ui/title';
import { ChatPanel } from './ChatPanel';

type Person = { userId: string; displayName: string };
const KIND = { group: 'Nhóm', event: 'Buổi', task: 'Việc' } as const;
export const anchorRoute = (a: ConversationSummaryDto['anchor']): Route =>
  a.type === 'group' ? { name: 'group', id: a.id } : a.type === 'event' ? { name: 'event', id: a.id } : { name: 'task', id: a.id };

/** Người nhắc tên được: thành viên nhóm; người phụ trách + người được xếp của buổi; người liên quan tới việc (máy chủ kiểm lại quyền). */
async function peopleOf(a: ConversationSummaryDto['anchor']): Promise<Person[]> {
  if (a.type === 'group') return (await api.group(a.id)).members;
  if (a.type === 'event') {
    const e = await api.event(a.id);
    const m = new Map<string, string>();
    for (const o of e.owners) m.set(o.userId, o.displayName);
    for (const p of e.positions) for (const x of p.assignments) if (x.status !== 'draft') m.set(x.userId, x.displayName);
    return [...m].map(([userId, displayName]) => ({ userId, displayName }));
  }
  const t = await api.task(a.id);
  return [t.owner, t.assignedBy, t.createdBy, ...t.collaborators].filter((x): x is NonNullable<typeof x> => !!x);
}

/** Màn hình hội thoại (UX §4.2b): tiêu đề là tên nhóm/buổi/việc, chạm để mở đối tượng (liên kết hai chiều). */
export function ChatScreen({ conversationId, meId }: { conversationId: string; meId: string }) {
  const [conv, setConv] = useState<ConversationSummaryDto | null>(null);
  const anchorKey = conv ? `${conv.anchor.type}:${conv.anchor.id}` : '';
  const people = useLoad(() => (conv ? peopleOf(conv.anchor) : Promise.resolve([] as Person[])), [anchorKey]);
  useSetTitle(conv ? { title: conv.anchor.name, subtitle: KIND[conv.anchor.type], href: href(anchorRoute(conv.anchor)) } : null);
  return <ChatPanel key={conversationId} conversationId={conversationId} meId={meId} members={people.data ?? []} onConversation={setConv} />;
}

/** Ô "Trò chuyện" trên trang nhóm/buổi/việc: mở hội thoại toàn màn hình. */
export function ChatLink({ conversationId, label, unread = 0 }: { conversationId: string; label: string; unread?: number }) {
  return (
    <section className="card flush">
      <ul className="list">
        <li>
          <a className="cell-link" href={href({ name: 'chat', id: conversationId })}>
            <span className="leading-icon">
              <Icon name="chats" size={18} />
            </span>
            <strong className="grow">{label}</strong>
            {unread > 0 && <span className="badge">{unread}</span>}
            <Icon name="chevron" size={18} />
          </a>
        </li>
      </ul>
    </section>
  );
}

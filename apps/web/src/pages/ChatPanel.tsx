import type { ConversationSummaryDto, GroupMemberDto, MessageDto, ObjectCardDto } from '@collab/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText, type UploadedFile } from '../lib/api';
import { openAttachment, sizeLabel, uploadFile } from '../lib/files';
import { useRealtime } from '../lib/realtime';
import { dialogs } from '../ui/dialogs';
import { Icon } from '../ui/icons';

interface Pending {
  clientMsgId: string;
  body: string;
  replyToId?: string;
  mentionIds: string[];
  attachments?: UploadedFile[];
  failed: boolean;
}

/** Tin chưa gửi được giữ ở máy (F9-T7) và gửi lại cùng clientMsgId nên không trùng (F9-T1). */
const pendingStore = {
  key: (id: string) => `collab.pending.${id}`,
  load(id: string): Pending[] {
    try {
      return JSON.parse(localStorage.getItem(this.key(id)) ?? '[]') as Pending[];
    } catch {
      return [];
    }
  },
  save(id: string, list: Pending[]) {
    try {
      if (list.length) localStorage.setItem(this.key(id), JSON.stringify(list));
      else localStorage.removeItem(this.key(id));
    } catch {
      /* bộ nhớ bị chặn: tin chờ chỉ sống trong phiên */
    }
  },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Hội thoại toàn màn hình (UX §4.2b): dòng tin, dòng hệ thống, ô soạn dính đáy; chạm vào tin để mở thao tác. */
export function ChatPanel({
  conversationId,
  meId,
  members,
  onConversation,
}: {
  conversationId: string;
  meId: string;
  members: Array<Pick<GroupMemberDto, 'userId' | 'displayName'>>;
  onConversation?: (c: ConversationSummaryDto) => void;
}) {
  const [conv, setConv] = useState<ConversationSummaryDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState<Pending[]>(() => pendingStore.load(conversationId));
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([]);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const onConversationRef = useRef(onConversation);
  onConversationRef.current = onConversation;
  const sending = useRef(false);

  const merge = useCallback((incoming: MessageDto[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const page = await api.messages(conversationId);
      merge(page.messages);
      setConv(page.conversation);
      onConversationRef.current?.(page.conversation);
      setError(null);
      const last = page.messages.at(-1)?.seq ?? 0;
      if (last > page.conversation.lastReadSeq) setConv(await api.markRead(conversationId, last));
      return page;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, [conversationId, merge]);

  useEffect(() => {
    void refresh().then((p) => p && setHasMore(p.hasMore));
  }, [refresh]);
  useRealtime([`conversation:${conversationId}`], () => void refresh());
  // Thân hàm có ngoặc: Chrome mới trả Promise từ scrollIntoView; effect trả Promise làm React gọi nó như hàm dọn → sập trang (trang trắng).
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending.length]);

  const updatePending = useCallback(
    (fn: (cur: Pending[]) => Pending[]) =>
      setPending((cur) => {
        const next = fn(cur);
        pendingStore.save(conversationId, next);
        return next;
      }),
    [conversationId],
  );

  const flush = useCallback(
    async (list: Pending[]) => {
      if (sending.current) return;
      sending.current = true;
      try {
        for (const p of list) {
          try {
            const m = await api.sendMessage(conversationId, p);
            merge([m]);
            updatePending((cur) => cur.filter((x) => x.clientMsgId !== p.clientMsgId));
          } catch (e) {
            if (e instanceof ApiError && e.status > 0) {
              // Lỗi nghiệp vụ (chỉ-đọc, mất quyền…): không thử lại.
              setError(e.message);
              updatePending((cur) => cur.filter((x) => x.clientMsgId !== p.clientMsgId));
            } else {
              updatePending((cur) => cur.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, failed: true } : x)));
              break; // mất mạng: giữ thứ tự, chờ có mạng
            }
          }
        }
      } finally {
        sending.current = false;
      }
    },
    [conversationId, merge, updatePending],
  );

  useEffect(() => {
    const retry = () => void flush(pendingStore.load(conversationId));
    window.addEventListener('online', retry);
    if (pending.length) retry();
    return () => window.removeEventListener('online', retry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, flush]);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const p: Pending = {
      clientMsgId: crypto.randomUUID(),
      body,
      replyToId: replyTo?.id,
      mentionIds: mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id),
      failed: false,
    };
    updatePending((cur) => [...cur, p]);
    setText('');
    setMentions([]);
    setReplyTo(null);
    void flush([...pendingStore.load(conversationId)]);
  };

  const [uploading, setUploading] = useState(false);
  const attach = async (file: File) => {
    if (!conv) return;
    setUploading(true);
    setError(null);
    try {
      const f = await uploadFile(conv.orgId, file);
      const body = text.trim() || `📎 ${file.name}`;
      const p: Pending = { clientMsgId: crypto.randomUUID(), body, replyToId: replyTo?.id, mentionIds: [], attachments: [f], failed: false };
      updatePending((cur) => [...cur, p]);
      setText('');
      setReplyTo(null);
      void flush([...pendingStore.load(conversationId)]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const page = await api.messages(conversationId, { beforeSeq: first.seq });
    merge(page.messages);
    setHasMore(page.hasMore);
  };

  const edit = async (m: MessageDto) => {
    const body = await dialogs.prompt({ title: 'Sửa tin nhắn', initial: m.body ?? '', multiline: true, required: true, confirmLabel: 'Lưu', maxLength: 4000 });
    if (body === null || !body.trim() || body === m.body) return;
    const keep = m.mentions.filter((x) => body.includes(`@${x.displayName}`)).map((x) => x.userId);
    try {
      merge([await api.editMessage(m.id, { body, mentionIds: keep })]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  // F10: tạo Task từ tin (phạm vi theo hội thoại); tiêu đề điền sẵn từ nội dung, người tạo sửa được.
  const makeTask = async (m: MessageDto) => {
    const title = await dialogs.prompt({
      title: 'Tạo việc từ tin nhắn',
      message: 'Việc mới sẽ gắn với tin này; bạn giao người và đặt hạn ở trang việc.',
      initial: (m.body ?? '').slice(0, 120),
      required: true,
      confirmLabel: 'Tạo việc',
      maxLength: 200,
    });
    if (!title?.trim()) return;
    try {
      const t = await api.createTask({ title: title.trim(), sourceMessageId: m.id });
      window.location.hash = `#task=${t.id}`;
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async (m: MessageDto) => {
    if (!(await dialogs.confirm({ title: 'Xoá tin nhắn này?', message: 'Không khôi phục được.', confirmLabel: 'Xoá', danger: true }))) return;
    try {
      merge([await api.deleteMessage(m.id)]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const others = members.filter((m) => m.userId !== meId);
  const readOnly = conv?.readOnly ?? false;

  type Act = 'reply' | 'copy' | 'edit' | 'delete' | 'task';
  const actions = async (m: MessageDto) => {
    if (m.deleted || m.kind !== 'user') return;
    const mine = m.senderId === meId;
    const options: Array<{ label: string; value: Act; danger?: boolean }> = [
      ...(readOnly ? [] : [{ label: 'Trả lời', value: 'reply' as const }]),
      { label: 'Sao chép', value: 'copy' },
      ...(readOnly ? [] : [{ label: 'Tạo việc từ tin này', value: 'task' as const }]),
      ...(mine && !readOnly ? [{ label: 'Sửa', value: 'edit' as const }] : []),
      ...(!readOnly ? [{ label: 'Xoá', value: 'delete' as const, danger: true }] : []),
    ];
    const pick = await dialogs.choose({ title: m.senderName ?? 'Tin nhắn', message: (m.body ?? '').slice(0, 140), options });
    if (pick === 'reply') setReplyTo(m);
    else if (pick === 'copy') void navigator.clipboard?.writeText(m.body ?? '').catch(() => undefined);
    else if (pick === 'edit') void edit(m);
    else if (pick === 'delete') void remove(m);
    else if (pick === 'task') void makeTask(m);
  };

  const mention = async () => {
    const m = await dialogs.choose({ title: 'Nhắc tên', options: others.map((o) => ({ label: o.displayName, value: o })) });
    if (!m) return;
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.displayName} `);
    setMentions((cur) => [...cur.filter((x) => x.id !== m.userId), { id: m.userId, name: m.displayName }]);
  };

  return (
    <div className="chat full">
      {hasMore && (
        <button className="button small older" onClick={() => void loadOlder()}>
          Xem tin cũ hơn
        </button>
      )}
      <ul className="messages">
        {messages.length === 0 && pending.length === 0 && <li className="hint center empty">Chưa có tin nhắn. Hãy gửi lời chào.</li>}
        {messages.map((m, i) => {
          const mine = m.senderId === meId;
          const prev = messages[i - 1];
          // Gộp tin liên tiếp của cùng người trong 5 phút: chỉ hiện tên ở tin đầu.
          const grouped = prev && prev.kind === 'user' && m.kind === 'user' && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          if (m.kind === 'system')
            return (
              <li key={m.id} className="msg system">
                <div className="body">{m.body}</div>
                {m.cards.length > 0 && <Cards cards={m.cards} />}
              </li>
            );
          return (
            <li key={m.id} className={`msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
              <button type="button" className="bubble" onClick={() => void actions(m)} aria-label="Thao tác với tin nhắn">
                {!mine && !grouped && <span className="sender">{m.senderName}</span>}
                {m.replyTo && (
                  <span className="quote">
                    {m.replyTo.senderName}: {m.replyTo.excerpt ?? 'Tin đã xoá'}
                  </span>
                )}
                {m.deleted ? <em className="deleted">Tin nhắn đã bị xoá</em> : <span className="body">{m.body}</span>}
                <span className="stamp">
                  {time(m.createdAt)}
                  {m.editedAt && !m.deleted && ' · đã sửa'}
                </span>
              </button>
              {m.attachments.length > 0 && (
                <div className="cards">
                  {m.attachments.map((a) => (
                    <button key={a.id} className="file-chip" onClick={() => void openAttachment(a.id).catch((e) => setError(errorText(e)))}>
                      <Icon name="attach" size={16} /> {a.filename} <span className="hint">{sizeLabel(a.sizeBytes)}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.cards.length > 0 && <Cards cards={m.cards} />}
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.clientMsgId} className="msg mine pending">
            <span className="bubble">
              <span className="body">{p.body}</span>
              <span className="stamp">{p.failed ? 'Chưa gửi được' : 'Đang gửi…'}</span>
            </span>
            {p.failed && (
              <button className="link retry" onClick={() => void flush(pending)}>
                Gửi lại
              </button>
            )}
          </li>
        ))}
      </ul>
      <div ref={bottom} className="chat-end" />
      {error && <p className="error center">{error}</p>}
      {readOnly ? (
        <p className="composer readonly hint">Hội thoại chỉ đọc: nhóm đã lưu trữ hoặc buổi/việc đã kết thúc. Bạn vẫn đọc được tin cũ.</p>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {replyTo && (
            <div className="replying">
              <span className="grow">
                Trả lời <strong>{replyTo.senderName}</strong>: {replyTo.body?.slice(0, 80)}
              </span>
              <button type="button" className="link" onClick={() => setReplyTo(null)}>
                Huỷ
              </button>
            </div>
          )}
          <div className="composer-row">
            <label className="icon-button" aria-label={uploading ? 'Đang tải tệp' : 'Đính kèm tệp'}>
              {uploading ? <span className="spinner" /> : <Icon name="attach" />}
              <input
                type="file"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void attach(f);
                }}
              />
            </label>
            {others.length > 0 && (
              <button type="button" className="icon-button" aria-label="Nhắc tên" onClick={() => void mention()}>
                <Icon name="at" />
              </button>
            )}
            <textarea
              rows={1}
              value={text}
              maxLength={4000}
              placeholder="Nhắn tin…"
              aria-label="Nội dung tin nhắn"
              onChange={(e) => {
                setText(e.target.value);
                // Tự giãn tới 5 dòng.
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                // Máy tính: Enter gửi, Shift+Enter xuống dòng. Điện thoại: Enter xuống dòng, gửi bằng nút.
                if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="send" disabled={!text.trim()} aria-label="Gửi">
              <Icon name="send" size={20} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Thẻ đối tượng dưới tin (CONTEXT_ENGINE §5): không xem được → "Nội dung bị giới hạn". */
export function Cards({ cards }: { cards: ObjectCardDto[] }) {
  return (
    <div className="cards">
      {cards.map((c) => (
        <a key={`${c.relation}:${c.type}:${c.id}`} className={c.available ? 'obj-card' : 'obj-card muted'} href={c.available ? `#${c.type}=${c.id}` : undefined}>
          <span className="leading-icon">
            <Icon name={c.type === 'event' ? 'calendar' : c.type === 'task' ? 'work' : 'groups'} size={18} />
          </span>
          <span className="grid">
            <strong>{c.available ? c.title : 'Nội dung bị giới hạn'}</strong>
            <span className="hint">
              {c.relation === 'created_from' ? 'Việc tạo từ tin này' : c.type === 'event' ? 'Buổi' : c.type === 'task' ? 'Việc' : 'Nhóm'}
              {c.available && c.subtitle ? ` · ${c.subtitle}` : ''}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

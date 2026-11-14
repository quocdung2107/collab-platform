import type { ConversationSummaryDto, GroupMemberDto, MessageDto, ObjectCardDto } from '@collab/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText, type UploadedFile } from '../lib/api';
import { openAttachment, sizeLabel, uploadFile } from '../lib/files';
import { useRealtime } from '../lib/realtime';

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

export function ChatPanel({ conversationId, meId, members }: { conversationId: string; meId: string; members: Array<Pick<GroupMemberDto, 'userId' | 'displayName'>> }) {
  const [conv, setConv] = useState<ConversationSummaryDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState<Pending[]>(() => pendingStore.load(conversationId));
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([]);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
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
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages.length, pending.length]);

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
    const body = window.prompt('Sửa tin nhắn', m.body ?? '');
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
    const title = window.prompt('Tên việc', (m.body ?? '').slice(0, 120));
    if (!title?.trim()) return;
    try {
      const t = await api.createTask({ title: title.trim(), sourceMessageId: m.id });
      window.location.hash = `#task=${t.id}`;
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async (m: MessageDto) => {
    if (!window.confirm('Xoá tin nhắn này? Không khôi phục được.')) return;
    try {
      merge([await api.deleteMessage(m.id)]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const others = members.filter((m) => m.userId !== meId);
  const readOnly = conv?.readOnly ?? false;

  return (
    <div className="chat">
      {hasMore && (
        <button className="button small" onClick={() => void loadOlder()}>
          Xem tin cũ hơn
        </button>
      )}
      <ul className="messages">
        {messages.length === 0 && pending.length === 0 && <li className="hint">Chưa có tin nhắn. Hãy chào cả nhóm.</li>}
        {messages.map((m) => {
          const mine = m.senderId === meId;
          return (
            <li key={m.id} className={m.kind === 'system' ? 'msg system' : mine ? 'msg mine' : 'msg'}>
              <div className="meta">
                <strong>{m.kind === 'system' ? 'Hệ thống' : m.senderName}</strong> <span className="hint">{time(m.createdAt)}</span>
                {m.editedAt && !m.deleted && <span className="hint"> · đã sửa</span>}
              </div>
              {m.replyTo && (
                <div className="quote">
                  ↪ {m.replyTo.senderName}: {m.replyTo.excerpt ?? 'Tin đã xoá'}
                </div>
              )}
              {m.deleted ? <em className="hint">Tin nhắn đã bị xoá</em> : <div className="body">{m.body}</div>}
              {m.attachments.length > 0 && (
                <div className="cards">
                  {m.attachments.map((a) => (
                    <button key={a.id} className="tag link" onClick={() => void openAttachment(a.id).catch((e) => setError(errorText(e)))}>
                      📎 {a.filename} <span className="hint">· {sizeLabel(a.sizeBytes)}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.cards.length > 0 && <Cards cards={m.cards} />}
              {!m.deleted && m.kind === 'user' && !readOnly && (
                <div className="row actions">
                  <button className="link" onClick={() => setReplyTo(m)}>
                    Trả lời
                  </button>
                  {mine && (
                    <button className="link" onClick={() => void edit(m)}>
                      Sửa
                    </button>
                  )}
                  <button className="link" onClick={() => void remove(m)}>
                    Xoá
                  </button>
                  <button className="link" onClick={() => void makeTask(m)}>
                    Tạo việc
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.clientMsgId} className="msg mine pending">
            <div className="body">{p.body}</div>
            <div className="hint">
              {p.failed ? 'Chưa gửi được, sẽ gửi lại khi có mạng · ' : 'Đang gửi…'}
              {p.failed && (
                <button className="link" onClick={() => void flush(pending)}>
                  Gửi lại
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div ref={bottom} />
      {error && <p className="error">{error}</p>}
      {readOnly ? (
        <p className="hint">Hội thoại đã khoá vì nhóm được lưu trữ. Bạn vẫn đọc được tin cũ.</p>
      ) : (
        <form
          className="grid"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {replyTo && (
            <div className="quote row">
              ↪ Trả lời {replyTo.senderName}: {replyTo.body?.slice(0, 80)}
              <button type="button" className="link" onClick={() => setReplyTo(null)}>
                Huỷ
              </button>
            </div>
          )}
          <textarea
            rows={2}
            value={text}
            maxLength={4000}
            placeholder="Nhắn cho cả nhóm…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="row">
            {others.length > 0 && (
              <select
                value=""
                aria-label="Nhắc tên"
                onChange={(e) => {
                  const m = others.find((x) => x.userId === e.target.value);
                  if (!m) return;
                  setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.displayName} `);
                  setMentions((cur) => [...cur.filter((x) => x.id !== m.userId), { id: m.userId, name: m.displayName }]);
                }}
              >
                <option value="">@ Nhắc tên…</option>
                {others.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            )}
            <label className="button small">
              {uploading ? 'Đang tải…' : '📎 Tệp'}
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
            <button className="button primary" disabled={!text.trim()}>
              Gửi
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
        <span key={`${c.relation}:${c.type}:${c.id}`} className="tag">
          {c.relation === 'created_from' ? 'Việc từ tin này: ' : ''}
          {c.available ? <a href={`#${c.type}=${c.id}`}>{c.title}</a> : 'Nội dung bị giới hạn'}
          {c.available && c.subtitle ? <span className="hint"> · {c.subtitle}</span> : null}
        </span>
      ))}
    </div>
  );
}

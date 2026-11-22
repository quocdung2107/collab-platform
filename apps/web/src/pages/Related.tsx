import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useAction, useLoad } from '@collab/client';

const UUID = /(event|task)=([0-9a-f-]{36})/i;

/** Khối Liên quan (CONTEXT_ENGINE §3.1, §3.2): tin nhắn nhắc tới, đối tượng liên quan (hai chiều), số mục ẩn. */
export function Related({ type, id, topic, canLink }: { type: 'event' | 'task'; id: string; topic: string; canLink: boolean }) {
  const rel = useLoad(() => api.related(type, id), [type, id]);
  useRealtime([topic], rel.reload);
  const act = useAction();
  const [target, setTarget] = useState('');
  const r = rel.data;
  if (!r) return null;
  const empty = !r.messages.length && !r.objects.length && !r.hiddenCount;
  if (empty && !canLink) return null;
  return (
    <section className="card">
      <h2>Liên quan</h2>
      {r.messages.length > 0 && (
        <ul className="list">
          {r.messages.map((m) => (
            <li key={m.linkId}>
              <span className="grid">
                <a href={href(m.anchor.type === 'group' ? { name: 'group', id: m.anchor.id } : { name: m.anchor.type, id: m.anchor.id })}>
                  {m.senderName ?? 'Ai đó'} trong {m.anchor.name}
                </a>
                <span className="hint">{m.excerpt}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.objects.length > 0 && (
        <ul className="list">
          {r.objects.map((o) => (
            <li key={o.linkId}>
              <span>
                <a href={`#${o.type}=${o.id}`}>{o.title}</a> <span className="hint">· {o.subtitle}</span>
              </span>
              {o.canUnlink && (
                <button className="button small" disabled={act.busy} onClick={() => void act.run(() => api.unlink(o.linkId), rel.reload)}>
                  Gỡ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.hiddenCount > 0 && <p className="hint">{r.hiddenCount} mục bạn không có quyền xem.</p>}
      {empty && <p className="hint">Chưa có gì liên quan. Dán đường dẫn của buổi/việc vào tin nhắn để liên kết.</p>}
      {canLink && (
        <form
          className="row"
          onSubmit={(x) => {
            x.preventDefault();
            const m = UUID.exec(target);
            if (!m) return;
            void act.run(() => api.linkObjects({ type, id }, { type: m[1]!.toLowerCase() as 'event' | 'task', id: m[2]! }), () => (setTarget(''), rel.reload()));
          }}
        >
          <input value={target} onChange={(x) => setTarget(x.target.value)} placeholder="Dán đường dẫn buổi/việc để liên kết" />
          <button className="button small" disabled={act.busy || !UUID.test(target)}>
            Liên kết
          </button>
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </section>
  );
}

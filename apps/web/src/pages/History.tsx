import type { HistoryEntryDto } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { useLoad } from '../lib/useLoad';

const at = (iso: string) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Entry({ e, nested }: { e: HistoryEntryDto; nested?: boolean }) {
  return (
    <li className={nested ? 'hint' : undefined}>
      <div>
        {!nested && <b>{e.actor?.displayName ?? 'Hệ thống'}</b>} {nested ? '↳ ' : ''}
        {e.text} {!nested && <span className="hint">· {at(e.occurredAt)}</span>}
      </div>
      {e.changes.map((c) => (
        <div key={c.field} className="hint">
          {c.field}: {c.before} → {c.after}
        </div>
      ))}
      {e.consequences.length > 0 && (
        <ul className="list">
          {e.consequences.map((c) => (
            <Entry key={c.id} e={c} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Khối Lịch sử (F13, UX §4): ai, khi nào, gì, trước → sau; hệ quả lồng dưới sự kiện gốc. Thu gọn mặc định. */
export function History({ type, id, topic }: { type: 'event' | 'task'; id: string; topic: string }) {
  const [open, setOpen] = useState(false);
  const hist = useLoad(() => (open ? api.history(type, id) : Promise.resolve(null)), [type, id, open]);
  useRealtime(open ? [topic] : [], hist.reload);
  return (
    <section className="card">
      <button className="button small" onClick={() => setOpen(!open)}>
        {open ? 'Ẩn lịch sử' : 'Xem lịch sử'}
      </button>
      {open && hist.error && <p className="error">{hist.error}</p>}
      {open && hist.data && (
        <ul className="list">
          {hist.data.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
          {!hist.data.length && <li className="hint">Chưa có thay đổi nào.</li>}
        </ul>
      )}
    </section>
  );
}

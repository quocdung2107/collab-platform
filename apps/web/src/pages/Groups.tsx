import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';

/** Tab Nhóm (UX §2): danh sách nhóm của tổ chức đang xem; quản trị tạo nhóm tại đây. */
export function Groups({ orgId, meId, isAdmin }: { orgId: string; meId: string; isAdmin: boolean }) {
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const convs = useLoad(() => api.conversations(orgId), [orgId]);
  const unread = new Map((convs.data ?? []).map((c) => [c.anchor.id, c.unreadCount]));
  useRealtime([`user:${meId}`], () => (groups.reload(), convs.reload()));
  const act = useAction();
  const [name, setName] = useState('');
  const mine = (groups.data ?? []).filter((g) => g.myRole && !g.archived);
  const others = (groups.data ?? []).filter((g) => !g.myRole || g.archived);

  const row = (g: NonNullable<typeof groups.data>[number]) => (
    <li key={g.id}>
      <a className="cell-link" href={href({ name: 'group', id: g.id })}>
        <span className="grid">
          <strong>{g.name}</strong>
          <span className="hint">
            {g.memberCount} người
            {g.myRole === 'leader' ? ' · bạn là trưởng nhóm' : ''}
            {g.archived ? ' · đã lưu trữ' : ''}
          </span>
        </span>
        {(unread.get(g.id) ?? 0) > 0 && <span className="badge">{unread.get(g.id)}</span>}
      </a>
    </li>
  );

  return (
    <>
      {groups.error && <p className="error">{groups.error}</p>}
      {!groups.data && !groups.error && <p className="center">Đang tải…</p>}
      {mine.length > 0 && (
        <section className="card">
          <h2>Nhóm của tôi</h2>
          <ul className="list">{mine.map(row)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="card">
          <h2>{mine.length ? 'Nhóm khác' : 'Các nhóm'}</h2>
          <ul className="list">{others.map(row)}</ul>
        </section>
      )}
      {groups.data?.length === 0 && (
        <section className="card">
          <p className="hint">Tổ chức chưa có nhóm nào.</p>
        </section>
      )}
      {isAdmin && (
        <section className="card">
          <h2>Tạo nhóm</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void act.run(
                () => api.createGroup(orgId, name),
                () => (setName(''), groups.reload()),
              );
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhóm mới" maxLength={120} required />
            <button className="button primary" disabled={act.busy}>
              Tạo
            </button>
          </form>
          {act.error && <p className="error">{act.error}</p>}
        </section>
      )}
    </>
  );
}

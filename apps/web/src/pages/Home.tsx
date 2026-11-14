import type { MeResponse } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { go, href } from '../lib/route';
import { useAction } from '../lib/useLoad';

const ROLE: Record<string, string> = { owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên' };
export const roleLabel = (r: string) => ROLE[r] ?? r;

export function Home({ me, onChanged }: { me: MeResponse; onChanged: () => void }) {
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  return (
    <section className="card">
      <h1>Xin chào, {me.user.displayName}</h1>
      {me.memberships.length === 0 ? (
        <p className="hint">Bạn chưa thuộc tổ chức nào. Hãy mở liên kết mời do người quản lý gửi, hoặc tạo tổ chức mới.</p>
      ) : (
        <ul className="list">
          {me.memberships.map((m) => (
            <li key={m.orgId}>
              <a href={href({ name: 'org', id: m.orgId })}>{m.orgName}</a>
              <span className="hint">{roleLabel(m.role)}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => api.createOrg(name),
            (o) => {
              setName('');
              onChanged();
              go({ name: 'org', id: o.id });
            },
          );
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên tổ chức mới" maxLength={120} required />
        <button className="button primary" disabled={busy}>
          Tạo
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

import type { MeResponse } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { setCurrentOrg } from '../lib/currentOrg';
import { go } from '../lib/route';
import { useAction } from '../lib/useLoad';
import { Today } from './Today';

const ROLE: Record<string, string> = { owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên' };
export const roleLabel = (r: string) => ROLE[r] ?? r;

/** Tab Việc của tôi (UX §4.1). Chưa thuộc tổ chức nào → hướng dẫn nhận lời mời hoặc tạo tổ chức. */
export function Home({ me, onChanged }: { me: MeResponse; onChanged: () => void }) {
  if (me.memberships.length > 0) return <Today meId={me.user.id} />;
  return (
    <section className="card">
      <h2>Xin chào, {me.user.displayName}</h2>
      <p className="hint">Bạn chưa thuộc tổ chức nào. Hãy mở liên kết mời do người quản lý gửi, hoặc tạo tổ chức mới.</p>
      <NewOrgForm onCreated={onChanged} />
    </section>
  );
}

export function NewOrgForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  return (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => api.createOrg(name),
            (o) => {
              setName('');
              setCurrentOrg(o.id);
              onCreated();
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
    </>
  );
}

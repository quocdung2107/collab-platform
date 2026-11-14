import type { MeResponse } from '@collab/shared';
import { setCurrentOrg } from '../lib/currentOrg';
import { href } from '../lib/route';
import { signOut } from '../lib/supabase';
import { Icon } from '../ui/icons';
import { initialsOf } from '../ui/Shell';
import { NewOrgForm, roleLabel } from './Home';

/** Menu cá nhân (UX §2, ảnh đại diện): hồ sơ · đổi tổ chức · quản lý tổ chức · cài đặt thông báo · đăng xuất. */
export function Me({ me, currentOrgId, onChanged }: { me: MeResponse; currentOrgId: string | null; onChanged: () => void }) {
  return (
    <>
      <section className="card profile">
        <span className="avatar big">{initialsOf(me.user.displayName)}</span>
        <span className="grid">
          <strong>{me.user.displayName}</strong>
          {me.user.email && <span className="hint">{me.user.email}</span>}
        </span>
      </section>

      {me.memberships.length > 0 && (
        <section className="card">
          <h2>Tổ chức</h2>
          <ul className="list">
            {me.memberships.map((m) => {
              const on = m.orgId === currentOrgId;
              const admin = m.role === 'owner' || m.role === 'admin';
              return (
                <li key={m.orgId}>
                  <button className={on ? 'cell-link choice on' : 'cell-link choice'} aria-pressed={on} onClick={() => setCurrentOrg(m.orgId)}>
                    <span className="radio" aria-hidden="true" />
                    <span className="grid">
                      <strong>{m.orgName}</strong>
                      <span className="hint">{roleLabel(m.role)}</span>
                    </span>
                  </button>
                  <a className="button small" href={href({ name: 'org', id: m.orgId })}>
                    {admin ? 'Quản lý' : 'Thành viên'}
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="hint">Lịch, Chat và Nhóm hiển thị theo tổ chức đang chọn.</p>
        </section>
      )}

      <section className="card flush">
        <ul className="list">
          <li>
            <a className="cell-link" href={href({ name: 'settings' })}>
              <span className="leading-icon">
                <Icon name="settings" size={20} />
              </span>
              <strong className="grow">Cài đặt thông báo</strong>
              <Icon name="chevron" size={18} />
            </a>
          </li>
          <li>
            <button className="cell-link danger" onClick={() => void signOut()}>
              <span className="leading-icon">
                <Icon name="logout" size={20} />
              </span>
              <strong className="grow">Đăng xuất</strong>
            </button>
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Tạo tổ chức mới</h2>
        <NewOrgForm onCreated={onChanged} />
      </section>
    </>
  );
}

import type { CreatedInviteDto, OrgRole } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { roleLabel } from './Home';

export function OrgPage({ orgId, meId, onMembershipChanged }: { orgId: string; meId: string; onMembershipChanged: () => void }) {
  const org = useLoad(() => api.org(orgId), [orgId]);
  const members = useLoad(() => api.members(orgId), [orgId]);
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const reload = () => (org.reload(), members.reload(), groups.reload());
  useRealtime([`user:${meId}`], () => (reload(), onMembershipChanged()));

  const act = useAction();
  const [groupName, setGroupName] = useState('');

  if (org.error) return <NotAvailable />;
  if (!org.data) return <p className="center">Đang tải…</p>;
  const o = org.data;
  const isAdmin = o.myRole === 'owner' || o.myRole === 'admin';
  const isOwner = o.myRole === 'owner';

  return (
    <>
      <section className="card">
        <a href="#" className="hint">
          ← Tổ chức của tôi
        </a>
        <h1>{o.name}</h1>
        <p className="hint">Vai trò của bạn: {roleLabel(o.myRole)}</p>
        {act.error && <p className="error">{act.error}</p>}
      </section>

      <section className="card">
        <h2>Nhóm</h2>
        <ul className="list">
          {groups.data?.map((g) => (
            <li key={g.id}>
              <a href={href({ name: 'group', id: g.id })}>{g.name}</a>
              <span className="hint">
                {g.memberCount} người{g.myRole ? ` · bạn là ${g.myRole === 'leader' ? 'trưởng nhóm' : 'thành viên'}` : ''}
              </span>
            </li>
          ))}
          {groups.data?.length === 0 && <li className="hint">Chưa có nhóm.</li>}
        </ul>
        {isAdmin && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void act.run(
                () => api.createGroup(orgId, groupName),
                () => (setGroupName(''), groups.reload()),
              );
            }}
          >
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Tên nhóm mới" maxLength={120} required />
            <button className="button" disabled={act.busy}>
              Tạo nhóm
            </button>
          </form>
        )}
      </section>

      {isAdmin && <Invites orgId={orgId} groups={groups.data?.map((g) => ({ id: g.id, name: g.name })) ?? []} />}

      <section className="card">
        <h2>Thành viên ({members.data?.length ?? '…'})</h2>
        <ul className="list">
          {members.data?.map((m) => {
            const self = m.userId === meId;
            const canEditRole = !self && (isOwner || (isAdmin && m.role !== 'owner'));
            return (
              <li key={m.userId}>
                <span>
                  {m.displayName}
                  {self && ' (bạn)'}
                  {m.email && <span className="hint"> · {m.email}</span>}
                </span>
                <span className="row">
                  {canEditRole ? (
                    <select
                      value={m.role}
                      disabled={act.busy}
                      onChange={(e) => void act.run(() => api.setMemberRole(orgId, m.userId, e.target.value as OrgRole), members.reload)}
                    >
                      {(isOwner ? ['owner', 'admin', 'member'] : ['admin', 'member']).map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="hint">{roleLabel(m.role)}</span>
                  )}
                  {canEditRole && (
                    <button
                      className="button small danger"
                      disabled={act.busy}
                      onClick={() =>
                        window.confirm(`Gỡ ${m.displayName} khỏi tổ chức? Người này sẽ rời mọi nhóm.`) &&
                        void act.run(() => api.removeMember(orgId, m.userId), reload)
                      }
                    >
                      Gỡ
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          className="button small"
          disabled={act.busy}
          onClick={() =>
            window.confirm('Rời tổ chức này?') &&
            void act.run(
              () => api.leaveOrg(orgId),
              () => (onMembershipChanged(), go({ name: 'home' })),
            )
          }
        >
          Rời tổ chức
        </button>
      </section>
    </>
  );
}

function Invites({ orgId, groups }: { orgId: string; groups: Array<{ id: string; name: string }> }) {
  const invites = useLoad(() => api.invites(orgId), [orgId]);
  const act = useAction();
  const [groupId, setGroupId] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [created, setCreated] = useState<CreatedInviteDto | null>(null);
  const link = created ? `${window.location.origin}${window.location.pathname}${href({ name: 'invite', token: created.token })}` : '';
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;

  return (
    <section className="card">
      <h2>Liên kết mời</h2>
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run(
            () => api.createInvite(orgId, { groupId: groupId || undefined, maxUses: maxUses ? Number(maxUses) : undefined }),
            (r) => (setCreated(r), invites.reload()),
          );
        }}
      >
        <label>
          Thêm vào nhóm{' '}
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">(không)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Số lượt tối đa <input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="không giới hạn" />
        </label>
        <button className="button primary" disabled={act.busy}>
          Tạo liên kết (hết hạn sau 7 ngày)
        </button>
      </form>
      {created && (
        <div className="grid">
          <p className="hint">Liên kết chỉ hiện một lần. Sao chép và gửi qua Zalo/Messenger:</p>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="button small" onClick={() => void navigator.clipboard?.writeText(link)}>
            Sao chép
          </button>
        </div>
      )}
      {act.error && <p className="error">{act.error}</p>}
      <ul className="list">
        {invites.data?.map((i) => (
          <li key={i.id}>
            <span className="hint">
              {groupName(i.groupId) ? `Nhóm ${groupName(i.groupId)} · ` : ''}
              {i.usedCount}/{i.maxUses ?? '∞'} lượt · hết hạn {new Date(i.expiresAt).toLocaleDateString('vi-VN')}
            </span>
            <button className="button small danger" disabled={act.busy} onClick={() => void act.run(() => api.revokeInvite(orgId, i.id), invites.reload)}>
              Thu hồi
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotAvailable() {
  return (
    <section className="card">
      <h1>Không tìm thấy</h1>
      <p className="hint">Mục này không tồn tại hoặc bạn không còn quyền xem.</p>
      <a className="button" href="#">
        Về trang chính
      </a>
    </section>
  );
}

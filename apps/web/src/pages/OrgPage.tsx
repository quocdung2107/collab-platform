import type { CreatedInviteDto, OrganizationDto, OrgRole } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '@collab/client';
import { confirmThen } from '../ui/dialogs';
import { Skeleton } from '../ui/kit';
import { roleLabel } from './Home';

/** Quản lý tổ chức (UX §4.10): thành viên, liên kết mời, rời tổ chức. Lịch và Nhóm nằm ở tab riêng. */
export function OrgPage({ orgId, meId, onMembershipChanged }: { orgId: string; meId: string; onMembershipChanged: () => void }) {
  const org = useLoad(() => api.org(orgId), [orgId]);
  const members = useLoad(() => api.members(orgId), [orgId]);
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const reload = () => (org.reload(), members.reload(), groups.reload());
  useRealtime([`user:${meId}`], () => (reload(), onMembershipChanged()));

  const act = useAction();

  if (org.error) return <NotAvailable />;
  if (!org.data) return <Skeleton rows={4} />;
  const o = org.data;
  const isAdmin = o.myRole === 'owner' || o.myRole === 'admin';
  const isOwner = o.myRole === 'owner';

  return (
    <>
      <section className="card">
        <h1>{o.name}</h1>
        <p className="hint">Vai trò của bạn: {roleLabel(o.myRole)}</p>
        {act.error && <p className="error">{act.error}</p>}
      </section>

      {isAdmin && <OrgInfo o={o} onSaved={reload} />}
      {isAdmin && <Templates orgId={orgId} />}
      {isAdmin && <Invites orgId={orgId} groups={groups.data?.map((g) => ({ id: g.id, name: g.name })) ?? []} />}

      <section className="card">
        <h2>Thành viên ({members.data?.length ?? '…'})</h2>
        <ul className="list">
          {members.data?.map((m) => {
            const self = m.userId === meId;
            const canEditRole = !self && (isOwner || (isAdmin && m.role !== 'owner'));
            return (
              <li key={m.userId}>
                <a href={href({ name: 'member', orgId, id: m.userId })}>
                  {m.displayName}
                  {self && ' (bạn)'}
                  {m.email && <span className="hint"> · {m.email}</span>}
                </a>
                <span className="row">
                  {canEditRole ? (
                    <select
                      value={m.role}
                      disabled={act.busy}
                      onChange={(e) => {
                        const role = e.target.value as OrgRole;
                        const run = () => act.run(() => api.setMemberRole(orgId, m.userId, role), members.reload);
                        if (role === 'owner') confirmThen({ title: `Chuyển quyền chủ sở hữu cho ${m.displayName}?`, message: 'Chủ sở hữu có toàn quyền, gồm cả gỡ người khác và đổi vai trò của bạn. Chỉ làm khi bạn chắc chắn.', confirmLabel: 'Tiếp tục', danger: true }, () => confirmThen({ title: 'Xác nhận lần cuối', message: `Đặt ${m.displayName} làm chủ sở hữu?`, confirmLabel: `Đặt ${m.displayName} làm chủ sở hữu`, danger: true }, run));
                        else void run();
                      }}
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
                        confirmThen({ title: `Gỡ ${m.displayName} khỏi tổ chức?`, message: 'Người này sẽ rời mọi nhóm; vị trí và việc của họ được báo cho người điều phối.', confirmLabel: 'Gỡ', danger: true }, () =>
                          act.run(() => api.removeMember(orgId, m.userId), reload),
                        )
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
            confirmThen({ title: 'Rời tổ chức này?', confirmLabel: 'Rời tổ chức', danger: true }, () =>
              act.run(
                () => api.leaveOrg(orgId),
                () => (onMembershipChanged(), go({ name: 'home' })),
              ),
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
        Về Việc của tôi
      </a>
    </section>
  );
}

const ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

/** Thông tin tổ chức và mặc định (UX §4.10): tên, múi giờ, ai thấy buổi mới, ngưỡng xác nhận lại. */
function OrgInfo({ o, onSaved }: { o: OrganizationDto; onSaved: () => void }) {
  const [name, setName] = useState(o.name);
  const [tz, setTz] = useState(o.timezone);
  const [vis, setVis] = useState(o.defaultEventVisibility);
  const [threshold, setThreshold] = useState(String(o.reconfirmThresholdMin));
  const act = useAction();
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];
  const dirty = name.trim() !== o.name || tz !== o.timezone || vis !== o.defaultEventVisibility || Number(threshold) !== o.reconfirmThresholdMin;
  return (
    <section className="card">
      <h2>Thông tin và mặc định</h2>
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run(() => api.updateOrg(o.id, { expectedVersion: o.version, name, timezone: tz, defaultEventVisibility: vis, reconfirmThresholdMin: Number(threshold) }), onSaved);
        }}
      >
        <label>
          Tên tổ chức
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </label>
        <label>
          Múi giờ
          <select value={tz} onChange={(e) => setTz(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buổi mới, ai thấy
          <select value={vis} onChange={(e) => setVis(e.target.value as 'org' | 'groups')}>
            <option value="org">Cả tổ chức</option>
            <option value="groups">Chỉ các nhóm tham gia và người được xếp</option>
          </select>
        </label>
        <label>
          Dời giờ quá bao nhiêu phút thì người đã nhận phải xác nhận lại
          <input type="number" inputMode="numeric" min={0} max={1440} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
        {act.error && <p className="error">{act.error}</p>}
        <button className="button primary" disabled={act.busy || !dirty}>
          Lưu
        </button>
      </form>
    </section>
  );
}

/** Mẫu buổi (UX §4.10): xem và lưu trữ; tạo mẫu từ một buổi có sẵn (Thao tác → Lưu làm mẫu). */
function Templates({ orgId }: { orgId: string }) {
  const list = useLoad(() => api.templates(orgId), [orgId]);
  const act = useAction();
  return (
    <section className="card">
      <h2>Mẫu buổi</h2>
      {list.data?.length === 0 && <p className="hint">Chưa có mẫu. Mở một buổi, chọn Thao tác → Lưu làm mẫu.</p>}
      <ul className="list">
        {list.data?.map((t) => (
          <li key={t.id}>
            <span className="grid">
              <strong>{t.name}</strong>
              <span className="hint">
                {t.definition.durationMin} phút · {t.definition.positions.length} vị trí{t.definition.tasks.length ? ` · ${t.definition.tasks.length} việc` : ''}
              </span>
            </span>
            <button
              className="button small danger"
              disabled={act.busy}
              onClick={() => confirmThen({ title: `Lưu trữ mẫu "${t.name}"?`, message: 'Buổi đã tạo từ mẫu này không đổi. Mẫu không còn hiện khi tạo buổi mới.', confirmLabel: 'Lưu trữ', danger: true }, () => act.run(() => api.archiveTemplate(t.id), list.reload))}
            >
              Lưu trữ
            </button>
          </li>
        ))}
      </ul>
      {act.error && <p className="error">{act.error}</p>}
    </section>
  );
}

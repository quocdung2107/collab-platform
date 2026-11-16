import { useState } from 'react';
import { api } from '../lib/api';
import { shortDay, timeLabel } from '../lib/datetime';
import { href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { confirmThen } from '../ui/dialogs';
import { Icon } from '../ui/icons';
import { Skeleton } from '../ui/kit';
import { initialsOf } from '../ui/Shell';
import { assignmentStatusLabel } from './EventLabels';
import { roleLabel } from './Home';

/** Hồ sơ thành viên (UX §4.7): ai, ở nhóm nào, sắp phục vụ gì. Không có lý do từ chối hay số liệu từ chối (UX §4.7 ngoại lệ). */
export function MemberPage({ orgId, userId, meId }: { orgId: string; userId: string; meId: string }) {
  const p = useLoad(() => api.memberProfile(orgId, userId), [orgId, userId]);
  if (p.error) {
    return (
      <section className="card empty-state">
        <Icon name="user" size={40} />
        <p>Thành viên đã rời tổ chức hoặc bạn không có quyền xem.</p>
      </section>
    );
  }
  if (!p.data) return <Skeleton rows={3} sections={2} />;
  const { member: m, groups, upcoming } = p.data;
  const self = m.userId === meId;
  return (
    <>
      <section className="card profile">
        <span className="avatar big">{initialsOf(m.displayName)}</span>
        <span className="grid">
          <strong>
            {m.displayName}
            {self && ' (bạn)'}
          </strong>
          <span className="hint">{roleLabel(m.role)}</span>
          {m.email && (
            <a className="hint" href={`mailto:${m.email}`}>
              {m.email}
            </a>
          )}
          {m.phone && (
            <a className="hint" href={`tel:${m.phone}`}>
              {m.phone}
            </a>
          )}
        </span>
      </section>
      {self && <Busy orgId={orgId} />}
      <section className="card">
        <h2>Nhóm</h2>
        {groups.length === 0 ? (
          <p className="hint">Chưa thuộc nhóm nào.</p>
        ) : (
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <a className="cell-link" href={href({ name: 'group', id: g.id })}>
                  <span className="leading-icon kind-group">
                    <Icon name="groups" size={18} />
                  </span>
                  <strong className="grow">{g.name}</strong>
                  {g.role === 'leader' && <span className="tag">Trưởng nhóm</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Sắp phục vụ</h2>
        {upcoming.length === 0 ? (
          <p className="hint">Chưa có buổi nào sắp tới mà bạn được xem.</p>
        ) : (
          <ul className="list">
            {upcoming.map((u, i) => (
              <li key={`${u.eventId}-${i}`}>
                <a className="cell-link" href={href({ name: 'event', id: u.eventId })}>
                  <span className="grid grow">
                    <strong>{u.eventTitle}</strong>
                    <span className="hint">
                      {u.positionName} · {shortDay(u.startsAt)} {timeLabel(u.startsAt)}
                    </span>
                  </span>
                  <span className={u.status === 'accepted' ? 'tag ok' : u.status === 'reconfirm' ? 'tag warn' : 'tag info'}>{assignmentStatusLabel[u.status]}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const fmt = (d: string) => d.split('-').reverse().join('/');
const todayIso = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** Ngày bận (AD-34): chỉ bạn xem được danh sách; người điều phối chỉ thấy cảnh báo lúc xếp bạn vào buổi trùng, không có lý do. */
function Busy({ orgId }: { orgId: string }) {
  const list = useLoad(() => api.myUnavailabilities(orgId), [orgId]);
  const act = useAction();
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState('');
  return (
    <section className="card">
      <h2>Ngày bận</h2>
      <p className="hint">Người điều phối sẽ được nhắc khi xếp bạn vào buổi rơi vào những ngày này. Họ không thấy danh sách và không có lý do.</p>
      {list.data?.length === 0 && <p className="hint">Chưa đánh dấu ngày bận nào.</p>}
      <ul className="list">
        {list.data?.map((u) => (
          <li key={u.id}>
            <strong className="grow">{u.startsOn === u.endsOn ? fmt(u.startsOn) : `${fmt(u.startsOn)} – ${fmt(u.endsOn)}`}</strong>
            <button
              className="button small"
              disabled={act.busy}
              onClick={() => confirmThen({ title: 'Bỏ khoảng ngày bận này?', message: fmt(u.startsOn) + (u.startsOn === u.endsOn ? '' : ` – ${fmt(u.endsOn)}`), confirmLabel: 'Bỏ' }, () => act.run(() => api.removeUnavailability(u.id), list.reload))}
            >
              Bỏ
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run(() => api.addUnavailability(orgId, { startsOn: from, endsOn: to || from }), () => {
            setTo('');
            list.reload();
          });
        }}
      >
        <label>
          Từ ngày
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          Đến ngày (bỏ trống nếu chỉ một ngày)
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        {act.error && <p className="error">{act.error}</p>}
        <button className="button primary" disabled={act.busy || !from}>
          Thêm ngày bận
        </button>
      </form>
    </section>
  );
}

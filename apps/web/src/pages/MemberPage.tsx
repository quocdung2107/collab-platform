import { api } from '../lib/api';
import { shortDay, timeLabel } from '../lib/datetime';
import { href } from '../lib/route';
import { useLoad } from '../lib/useLoad';
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

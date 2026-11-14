import { useState } from 'react';
import { api } from '../lib/api';
import { dayLabel, timeLabel } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useLoad } from '../lib/useLoad';
import { assignmentStatusLabel, eventStatusLabel } from './EventLabels';

const WEEK = 7 * 24 * 3600_000;

/** Lịch phục vụ của tổ chức (F3): 8 tuần tới, lọc "của tôi". */
export function Calendar({ orgId, meId, canCreate }: { orgId: string; meId: string; canCreate: boolean }) {
  const [mine, setMine] = useState(false);
  const [weeks, setWeeks] = useState(8);
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const to = new Date(Date.now() + weeks * WEEK).toISOString();
  const events = useLoad(() => api.events(orgId, { from, to, mine }), [orgId, mine, weeks]);
  useRealtime([`user:${meId}`], events.reload);

  return (
    <section className="card">
      <h2>Lịch phục vụ</h2>
      <div className="row">
        <label className="row hint">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Chỉ buổi tôi được xếp
        </label>
        {canCreate && (
          <a className="button small primary" href={href({ name: 'newevent', id: orgId })}>
            Tạo buổi
          </a>
        )}
      </div>
      {events.error && <p className="error">{events.error}</p>}
      <ul className="list">
        {events.data?.map((e) => (
          <li key={e.id}>
            <span className="grid">
              <a href={href({ name: 'event', id: e.id })}>{e.title}</a>
              <span className="hint">
                {dayLabel(e.startsAt)} · {timeLabel(e.startsAt)}
                {e.location ? ` · ${e.location}` : ''}
              </span>
              {e.myAssignments.map((a) => (
                <span key={a.id} className="hint">
                  Bạn: {a.positionName} · có mặt {timeLabel(a.reportAt)} · {assignmentStatusLabel[a.status]}
                </span>
              ))}
            </span>
            <span className="row">
              {e.status !== 'published' && <span className="tag">{eventStatusLabel[e.status]}</span>}
              {e.slotsTotal > 0 && (
                <span className={e.slotsFilled < e.slotsTotal ? 'tag warn' : 'tag'}>
                  {e.slotsFilled}/{e.slotsTotal} người
                </span>
              )}
            </span>
          </li>
        ))}
        {events.data?.length === 0 && <li className="hint">Chưa có buổi nào trong {weeks} tuần tới.</li>}
      </ul>
      {events.data && (
        <button className="button small" onClick={() => setWeeks((w) => w + 8)}>
          Xem xa hơn
        </button>
      )}
    </section>
  );
}

/** Tab Lịch: người được tạo buổi = quản trị tổ chức hoặc trưởng một nhóm còn hoạt động (như trang tổ chức trước đây). */
export function CalendarTab({ orgId, meId, isAdmin }: { orgId: string; meId: string; isAdmin: boolean }) {
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const canCreate = isAdmin || (groups.data ?? []).some((g) => g.myRole === 'leader' && !g.archived);
  return <Calendar orgId={orgId} meId={meId} canCreate={canCreate} />;
}

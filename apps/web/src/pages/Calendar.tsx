import { useState } from 'react';
import { api } from '../lib/api';
import type { GroupSummaryDto } from '@collab/shared';
import { shortDay, timeLabel } from '@collab/client';
import { cellKey, fold, monthCells, monthRange } from '@collab/client';
import { Icon } from '../ui/icons';
import { Segmented, Skeleton } from '../ui/kit';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useLoad } from '@collab/client';
import { assignmentStatusLabel, eventStatusLabel } from './EventLabels';

const WEEK = 7 * 24 * 3600_000;

/** Khoá ngày theo giờ máy để nhóm buổi theo ngày. */
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayHeader = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  if (d.toDateString() === today.toDateString()) return `Hôm nay · ${shortDay(iso)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Ngày mai · ${shortDay(iso)}`;
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
};

type Filter = 'all' | 'mine' | 'group';

/** Lịch phục vụ của tổ chức (UX §4.5, F3): 8 tuần tới, nhóm theo ngày; lọc Tất cả / Của tôi / Theo nhóm. */
export function Calendar({ orgId, meId, canCreate, groups = [] }: { orgId: string; meId: string; canCreate: boolean; groups?: GroupSummaryDto[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [groupId, setGroupId] = useState('');
  const [weeks, setWeeks] = useState(8);
  const [view, setView] = useState<'list' | 'month'>('list');
  const [q, setQ] = useState('');
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [picked, setPicked] = useState<string | null>(cellKey(now));
  const mine = filter === 'mine';
  const range = view === 'month' ? monthRange(ym.y, ym.m) : { from: new Date(Date.now() - 24 * 3600_000).toISOString(), to: new Date(Date.now() + weeks * WEEK).toISOString() };
  const events = useLoad(() => api.events(orgId, { from: range.from, to: range.to, mine }), [orgId, mine, weeks, view, ym.y, ym.m]);
  useRealtime([`user:${meId}`], events.reload);
  const activeGroups = groups.filter((g) => !g.archived);
  const pickedGroup = groupId || activeGroups.find((g) => g.myRole)?.id || activeGroups[0]?.id || '';
  const needle = fold(q.trim());
  const list = (events.data ?? []).filter((e) => (filter !== 'group' || e.groups.some((g) => g.id === pickedGroup)) && (!needle || fold(e.title).includes(needle) || fold(e.location ?? '').includes(needle)));

  const days: Array<{ key: string; label: string; items: typeof list }> = [];
  for (const e of list) {
    const k = dayKey(e.startsAt);
    const last = days[days.length - 1];
    if (last && last.key === k) last.items.push(e);
    else days.push({ key: k, label: dayHeader(e.startsAt), items: [e] });
  }

  return (
    <>
      <div className="toolbar">
        <Segmented
          label="Lọc lịch"
          value={filter}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'mine', label: 'Của tôi' },
            ...(activeGroups.length ? [{ value: 'group' as const, label: 'Theo nhóm' }] : []),
          ]}
          onChange={setFilter}
        />
        {canCreate && (
          <a className="button small" href={href({ name: 'plan' })}>
            Lập lịch
          </a>
        )}
      </div>
      {filter === 'group' && (
        <select aria-label="Nhóm" value={pickedGroup} onChange={(e) => setGroupId(e.target.value)}>
          {activeGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <div className="toolbar">
        <input className="grow" type="search" placeholder="Lọc theo tên" aria-label="Lọc theo tên" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented label="Kiểu xem" value={view} options={[{ value: 'list', label: 'Danh sách' }, { value: 'month', label: 'Tháng' }]} onChange={setView} />
      </div>
      {view === 'month' && (
        <MonthGrid ym={ym} setYm={(v) => (setYm(v), setPicked(null))} items={list} picked={picked} onPick={setPicked} />
      )}
      {events.error && <p className="error">{events.error}</p>}
      {!events.data && !events.error && <Skeleton rows={3} sections={2} />}
      {days.filter((d) => view === 'list' || d.key === picked).map((d) => (
        <section key={d.key} className="card">
          <h2>{d.label}</h2>
          <ul className="list">
            {d.items.map((e) => (
              <li key={e.id}>
                <a className="cell-link" href={href({ name: 'event', id: e.id })}>
                  <span className="time-tile">
                    <b>{timeLabel(e.startsAt)}</b>
                    <span>{timeLabel(e.endsAt)}</span>
                  </span>
                  <span className="grid">
                    <strong className={e.status === 'cancelled' ? 'struck' : undefined}>{e.title}</strong>
                    {e.location && <span className="hint">{e.location}</span>}
                    {e.myAssignments.map((a) => (
                      <span key={a.id} className="hint mine-line">
                        Bạn: {a.positionName} · có mặt {timeLabel(a.reportAt)} · {assignmentStatusLabel[a.status]}
                      </span>
                    ))}
                  </span>
                  <span className="tags">
                    {e.status !== 'published' && <span className={e.status === 'cancelled' ? 'tag warn' : 'tag'}>{eventStatusLabel[e.status]}</span>}
                    {e.status === 'published' && e.slotsTotal > 0 && (
                      <span className={e.slotsFilled < e.slotsTotal ? 'tag warn' : 'tag ok'}>
                        {e.slotsFilled < e.slotsTotal ? `thiếu ${e.slotsTotal - e.slotsFilled}` : 'đủ người'}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {events.data && (view === 'list' ? list.length === 0 : !!picked && !days.some((d) => d.key === picked)) && (
        <section className="card empty-state">
          <Icon name="calendar" size={40} />
          <p>{filter === 'mine' ? `Bạn chưa được xếp buổi nào trong ${weeks} tuần tới.` : `Chưa có buổi nào trong ${weeks} tuần tới.`}</p>
        </section>
      )}
      {events.data && view === 'list' && (
        <button className="button" onClick={() => setWeeks((w) => w + 8)}>
          Xem xa hơn
        </button>
      )}
      {canCreate && (
        <a className="fab" href={href({ name: 'newevent', id: orgId })} aria-label="Tạo buổi">
          <Icon name="plus" size={26} />
        </a>
      )}
    </>
  );
}

/** Tab Lịch: người được tạo buổi = quản trị tổ chức hoặc trưởng một nhóm còn hoạt động (như trang tổ chức trước đây). */
export function CalendarTab({ orgId, meId, isAdmin }: { orgId: string; meId: string; isAdmin: boolean }) {
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const canCreate = isAdmin || (groups.data ?? []).some((g) => g.myRole === 'leader' && !g.archived);
  return <Calendar orgId={orgId} meId={meId} canCreate={canCreate} groups={groups.data ?? []} />;
}

const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** Lưới tháng: mỗi ngày có chấm theo số buổi (cam nếu có buổi thiếu người); chạm ngày để xem danh sách bên dưới. */
function MonthGrid({
  ym,
  setYm,
  items,
  picked,
  onPick,
}: {
  ym: { y: number; m: number };
  setYm: (v: { y: number; m: number }) => void;
  items: Array<{ startsAt: string; status: string; slotsTotal: number; slotsFilled: number }>;
  picked: string | null;
  onPick: (k: string) => void;
}) {
  const byDay = new Map<string, { n: number; short: boolean }>();
  for (const e of items) {
    if (e.status === 'cancelled') continue;
    const k = dayKey(e.startsAt);
    const cur = byDay.get(k) ?? { n: 0, short: false };
    cur.n += 1;
    cur.short ||= e.status === 'published' && e.slotsTotal > e.slotsFilled;
    byDay.set(k, cur);
  }
  const step = (d: number) => setYm(new Date(ym.y, ym.m + d, 1).getMonth() === ym.m ? ym : { y: new Date(ym.y, ym.m + d, 1).getFullYear(), m: new Date(ym.y, ym.m + d, 1).getMonth() });
  const today = cellKey(new Date());
  return (
    <section className="card month">
      <div className="month-head">
        <button className="icon-button" aria-label="Tháng trước" onClick={() => step(-1)}>
          <Icon name="chevron" size={18} />
        </button>
        <strong>
          Tháng {ym.m + 1}/{ym.y}
        </strong>
        <button className="icon-button" aria-label="Tháng sau" onClick={() => step(1)}>
          <Icon name="chevron" size={18} />
        </button>
      </div>
      <div className="month-grid" role="grid">
        {WD.map((w) => (
          <span key={w} className="month-wd">
            {w}
          </span>
        ))}
        {monthCells(ym.y, ym.m)
          .flat()
          .map((c) => {
            const info = byDay.get(c.key);
            return (
              <button key={c.key} className={`month-day${c.inMonth ? '' : ' out'}${picked === c.key ? ' on' : ''}${today === c.key ? ' today' : ''}`} aria-pressed={picked === c.key} aria-label={`${c.date.getDate()}/${c.date.getMonth() + 1}${info ? `, ${info.n} buổi` : ''}`} onClick={() => onPick(c.key)}>
                <span>{c.date.getDate()}</span>
                <i className={info ? (info.short ? 'dot short' : 'dot') : 'dot none'} />
              </button>
            );
          })}
      </div>
    </section>
  );
}

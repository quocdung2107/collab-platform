import type { EventSummaryDto } from '@collab/shared';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { timeLabel } from '../lib/datetime';
import {
  ONE_OFF,
  WEEKDAYS,
  addDays,
  attention,
  buildSeries,
  dm,
  matrix,
  periodLabel,
  periodOf,
  sameDay,
  seriesWhen,
  shift,
  startOfWeek,
  startsIn,
  stats,
  statusLabel,
  statusOf,
  weekdayOf,
  weeksIn,
  worst,
  yearFetchRange,
  yearTree,
  type Series,
  type Stats,
  type Zoom,
} from '../lib/planning';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { Segmented, Sheet, Skeleton, useMedia } from '../ui/kit';

/**
 * Lập lịch nhiều cấp (AD-32, UX §4.5b), bước P1: bốn mức Năm/Quý/Tháng/Tuần (L1), cây tổng quan (L2),
 * bảng nhịp để ẩn/hiện (L3). Chỉ đọc; chạm buổi mở trang Buổi. Nhịp tạm suy ra từ buổi có sẵn (IN-53).
 */
const ZOOMS: Array<{ value: Zoom; label: string }> = [
  { value: 'year', label: 'Năm' },
  { value: 'quarter', label: 'Quý' },
  { value: 'month', label: 'Tháng' },
  { value: 'week', label: 'Tuần' },
];
const ZOOM_KEY = 'collab.plan.zoom';
const hiddenKey = (orgId: string) => `collab.plan.hidden.${orgId}`;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* bộ nhớ bị chặn: chỉ mất phần ghi nhớ */
  }
};

type Ev = EventSummaryDto;

export function Planner({ orgId, meId }: { orgId: string; meId: string }) {
  const [zoom, setZoomState] = useState<Zoom>(() => (ZOOMS.some((z) => z.value === read(ZOOM_KEY)) ? (read(ZOOM_KEY) as Zoom) : 'quarter'));
  const [anchor, setAnchor] = useState(() => new Date());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(JSON.parse(read(hiddenKey(orgId)) ?? '[]') as string[]));
  const [sheet, setSheet] = useState<'tree' | 'series' | null>(null);
  const showTree = useMedia('(min-width: 1200px)');
  const showSeries = useMedia('(min-width: 1600px)');
  const wide = useMedia('(min-width: 720px)');
  const year = anchor.getFullYear();
  const range = yearFetchRange(year);
  const events = useLoad(() => api.events(orgId, { from: range.start.toISOString(), to: range.end.toISOString() }), [orgId, year]);
  useRealtime([`user:${meId}`], events.reload);
  const now = new Date();

  const setZoom = (z: Zoom) => (setZoomState(z), write(ZOOM_KEY, z));
  const pick = useCallback((z: Zoom, d: Date) => (setZoomState(z), write(ZOOM_KEY, z), setAnchor(d), setSheet(null)), []);
  const toggle = (key: string) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(hiddenKey(orgId), JSON.stringify([...next]));
      return next;
    });
  const showAll = () => (setHidden(new Set()), write(hiddenKey(orgId), '[]'));

  const all = events.data ?? [];
  const index = useMemo(() => buildSeries(all), [all]);
  const visible = all.filter((e) => !hidden.has(index.keyOf.get(e.id) ?? ''));
  const shownSeries = index.series.filter((s) => !hidden.has(s.key));
  const period = periodOf(zoom, anchor);
  const inPeriod = visible.filter((e) => startsIn(e, period));
  const sum = stats(inPeriod, now);

  const tree = <Tree year={year} events={visible} now={now} zoom={zoom} anchor={anchor} onPick={pick} />;
  const seriesPanel = <SeriesPanel series={index.series} hidden={hidden} onToggle={toggle} onShowAll={showAll} />;

  return (
    <div className={`planner${showTree ? ' with-tree' : ''}${showSeries ? ' with-series' : ''}`}>
      {showTree && <aside className="plan-side card">{tree}</aside>}
      <div className="plan-main">
        <Segmented label="Mức xem" value={zoom} options={ZOOMS} onChange={setZoom} />
        <div className="plan-nav">
          <button className="icon-button" aria-label="Trước" onClick={() => setAnchor(shift(zoom, anchor, -1))}>
            <Icon name="back" size={22} />
          </button>
          <button className="plan-crumb" onClick={() => !showTree && setSheet('tree')} aria-label="Mở tổng quan">
            <span className="hint small">
              {crumb(zoom, anchor)}
              {!showTree && ' ▾'}
            </span>
            <strong>{periodLabel(zoom, anchor)}</strong>
          </button>
          <button className="icon-button" aria-label="Sau" onClick={() => setAnchor(shift(zoom, anchor, 1))}>
            <Icon name="chevron" size={22} />
          </button>
          <span className="grow" />
          <button className="button small" onClick={() => setAnchor(new Date())}>
            Hôm nay
          </button>
          {!showSeries && (
            <button className="button small" onClick={() => setSheet('series')}>
              Nhịp{hidden.size ? ` (ẩn ${hidden.size})` : ''}
            </button>
          )}
        </div>
        <SummaryChips s={sum} />
        {events.error && <p className="error">{events.error}</p>}
        {!events.data && !events.error && <Skeleton rows={4} />}
        {events.data && all.length >= 1000 && <p className="hint small">Năm này có hơn 1000 buổi; chỉ hiện 1000 buổi đầu.</p>}
        {events.data &&
          (zoom === 'year' ? (
            <YearView year={year} events={visible} now={now} onPick={pick} />
          ) : zoom === 'quarter' ? (
            <QuarterView weeks={weeksIn(period)} series={shownSeries} events={visible} keyOf={index.keyOf} now={now} wide={wide} onPick={pick} />
          ) : zoom === 'month' ? (
            <MonthView anchor={anchor} events={visible} keyOf={index.keyOf} series={index.series} now={now} onPick={pick} />
          ) : (
            <WeekView anchor={anchor} events={visible} keyOf={index.keyOf} series={index.series} now={now} onPick={pick} />
          ))}
      </div>
      {showSeries && <aside className="plan-side card">{seriesPanel}</aside>}
      {sheet === 'tree' && (
        <Sheet title={`Tổng quan ${year}`} onClose={() => setSheet(null)}>
          {tree}
        </Sheet>
      )}
      {sheet === 'series' && (
        <Sheet title="Nhịp" onClose={() => setSheet(null)}>
          {seriesPanel}
        </Sheet>
      )}
    </div>
  );
}

/** Đường dẫn ngữ cảnh phía trên nhãn khoảng: 2027 › Q1 › Tháng 2. */
function crumb(zoom: Zoom, a: Date) {
  const parts = [String(a.getFullYear())];
  if (zoom !== 'year') parts.push(`Q${Math.floor(a.getMonth() / 3) + 1}`);
  if (zoom === 'week') parts.push(`Tháng ${startOfWeek(a).getMonth() + 1}`);
  return zoom === 'year' ? 'Tổng quan' : parts.join(' › ');
}

function SummaryChips({ s }: { s: Stats }) {
  return (
    <div className="plan-chips" aria-label="Tóm tắt khoảng đang xem">
      <span className="tag">{s.total} buổi</span>
      {s.short > 0 && <span className="tag warn">{s.short} thiếu người</span>}
      {s.draft > 0 && <span className="tag info">{s.draft} nháp chưa gửi</span>}
      {s.cancelled > 0 && <span className="tag">{s.cancelled} đã huỷ</span>}
    </div>
  );
}

const Attn = ({ s }: { s: Stats }) =>
  s.short > 0 ? <span className="tag warn">{s.short + s.draft}</span> : s.draft > 0 ? <span className="tag info">{s.draft}</span> : s.total > 0 ? <span className="tag ok">{s.total}</span> : null;

// ---------------------------------------------------------------- L2: cây tổng quan

function Tree({ year, events, now, zoom, anchor, onPick }: { year: number; events: Ev[]; now: Date; zoom: Zoom; anchor: Date; onPick: (z: Zoom, d: Date) => void }) {
  const t = useMemo(() => yearTree(year, events, now), [year, events, now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const aq = Math.floor(anchor.getMonth() / 3);
  const am = anchor.getMonth();
  const on = (z: Zoom, d: Date) => z === zoom && periodOf(z, d).start.getTime() === periodOf(zoom, anchor).start.getTime();
  const Node = ({ z, d, depth, label, s }: { z: Zoom; d: Date; depth: number; label: ReactNode; s: Stats }) => (
    <li>
      <button className={`tree-node d${depth}${on(z, d) ? ' on' : ''}`} onClick={() => onPick(z, d)}>
        <span className="grow">{label}</span>
        <Attn s={s} />
      </button>
    </li>
  );
  return (
    <nav aria-label="Tổng quan năm">
      <ul className="tree">
        <Node z="year" d={new Date(year, 0, 1)} depth={0} label={`Năm ${year}`} s={t.stats} />
        {t.quarters.map((q, qi) => (
          <li key={q.quarter}>
            <ul className="tree">
              <Node z="quarter" d={q.start} depth={1} label={`${qi === aq ? '▾' : '▸'} Q${q.quarter}`} s={q.stats} />
              {qi === aq &&
                q.months.map((m) => (
                  <li key={m.month}>
                    <ul className="tree">
                      <Node z="month" d={m.start} depth={2} label={`${m.month - 1 === am ? '▾' : '▸'} Tháng ${m.month}`} s={m.stats} />
                      {m.month - 1 === am &&
                        m.weeks.map((w) => <Node key={w.start.getTime()} z="week" d={w.start} depth={3} label={`${dm(w.start)}–${dm(addDays(w.start, 6))}`} s={w.stats} />)}
                    </ul>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="hint small">Số trên mỗi dòng: cam = thiếu người, xanh nhạt = nháp chưa gửi, xanh lá = số buổi.</p>
    </nav>
  );
}

// ---------------------------------------------------------------- L3: nhịp

function SeriesPanel({ series, hidden, onToggle, onShowAll }: { series: Series[]; hidden: Set<string>; onToggle: (k: string) => void; onShowAll: () => void }) {
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="row spread">
        <h2 className="plan-h">Nhịp trong năm</h2>
        {hidden.size > 0 && (
          <button className="button small" onClick={onShowAll}>
            Hiện tất cả
          </button>
        )}
      </div>
      {series.length === 0 && <p className="hint small">Chưa có buổi nào trong năm này.</p>}
      <ul className="list">
        {series.map((s) => (
          <li key={s.key}>
            <label className="series-row">
              <input type="checkbox" checked={!hidden.has(s.key)} onChange={() => onToggle(s.key)} />
              <SeriesDot s={s} />
              <span className="grid grow">
                <strong>{s.title}</strong>
                <span className="hint small">
                  {seriesWhen(s)} · {s.count} buổi
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="hint small">Nhịp hiện được gom từ các buổi có cùng mẫu (hoặc cùng tên), cùng thứ và giờ. Tạo và sửa nhịp có ở bước sau.</p>
    </div>
  );
}

const SeriesDot = ({ s }: { s: Series | undefined }) => <i className={`sdot c${s && s.color >= 0 ? s.color : 'x'}`} aria-hidden="true" />;

// ---------------------------------------------------------------- L1: bốn mức

function YearView({ year, events, now, onPick }: { year: number; events: Ev[]; now: Date; onPick: (z: Zoom, d: Date) => void }) {
  return (
    <div className="plan-year">
      {Array.from({ length: 12 }, (_, m) => {
        const p = periodOf('month', new Date(year, m, 1));
        const evs = events.filter((e) => startsIn(e, p));
        const s = stats(evs, now);
        return (
          <button key={m} className="card plan-month" onClick={() => onPick('month', p.start)}>
            <span className="row spread">
              <strong>Tháng {m + 1}</strong>
              <span className="hint small">{s.total} buổi</span>
            </span>
            <span className="week-heat" aria-hidden="true">
              {weeksIn(p).map((w) => {
                const st = worst(evs.filter((e) => startsIn(e, { start: w, end: addDays(w, 7) })), now);
                return <i key={w.getTime()} className={st ? `s-${st}` : 's-none'} />;
              })}
            </span>
            <span className="plan-chips">
              {s.short > 0 && <span className="tag warn">{s.short} thiếu</span>}
              {s.draft > 0 && <span className="tag info">{s.draft} nháp</span>}
              {attention(s) === 0 && s.total > 0 && <span className="tag ok">ổn</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Cell({ evs, gap, now }: { evs: Ev[]; gap: boolean; now: Date }) {
  if (!evs.length) return gap ? <span className="pcell s-gap" title="Tuần trống giữa các buổi của nhịp này">trống</span> : <span className="pcell s-none" />;
  const e = evs[0]!;
  const st = statusOf(e, now);
  return (
    <a className={`pcell s-${st}`} href={href({ name: 'event', id: e.id })} title={`${e.title} · ${dm(new Date(e.startsAt))} ${timeLabel(e.startsAt)}`}>
      {st === 'past' ? '✓' : statusLabel(e, st)}
      {evs.length > 1 && <small> +{evs.length - 1}</small>}
    </a>
  );
}

function QuarterView({
  weeks,
  series,
  events,
  keyOf,
  now,
  wide,
  onPick,
}: {
  weeks: Date[];
  series: Series[];
  events: Ev[];
  keyOf: Map<string, string>;
  now: Date;
  wide: boolean;
  onPick: (z: Zoom, d: Date) => void;
}) {
  const m = matrix(weeks, series, events, keyOf);
  const thisWeek = startOfWeek(now).getTime();
  if (!series.length) return <Empty text="Không có buổi nào trong quý này (hoặc mọi nhịp đang ẩn)." />;
  const weekBtn = (w: Date) => (
    <button className={`pweek${w.getTime() === thisWeek ? ' now' : ''}`} onClick={() => onPick('week', w)}>
      {dm(w)}
    </button>
  );
  const seriesHead = (s: Series) => (
    <span className="phead">
      <SeriesDot s={s} />
      <span className="grid">
        <strong>{s.title}</strong>
        <span className="hint small">{s.key === ONE_OFF ? 'các buổi một lần' : seriesWhen(s)}</span>
      </span>
    </span>
  );
  // Máy rộng: hàng = nhịp, cột = tuần. Điện thoại: hàng = tuần, cột = nhịp (cuộn ngang khi nhiều nhịp).
  return (
    <div className="pmx-wrap card flush">
      {wide ? (
        <div className="pmx" style={{ gridTemplateColumns: `minmax(140px, 1.6fr) repeat(${weeks.length}, minmax(42px, 1fr))` }}>
          <span />
          {weeks.map((w) => (
            <span key={w.getTime()}>{weekBtn(w)}</span>
          ))}
          {series.map((s) => (
            <Row key={s.key}>
              {seriesHead(s)}
              {m.get(s.key)!.map((c, i) => (
                <Cell key={i} evs={c.events} gap={c.gap} now={now} />
              ))}
            </Row>
          ))}
        </div>
      ) : (
        <div className="pmx" style={{ gridTemplateColumns: `52px repeat(${series.length}, minmax(68px, 1fr))` }}>
          <span className="hint small">Tuần</span>
          {series.map((s) => (
            <span key={s.key} className="phead narrow">
              <SeriesDot s={s} />
              <strong>{s.weekday >= 0 ? `${WEEKDAYS[s.weekday]} ${s.time}` : 'Lẻ'}</strong>
              <span className="hint small">{s.title}</span>
            </span>
          ))}
          {weeks.map((w, i) => (
            <Row key={w.getTime()}>
              {weekBtn(w)}
              {series.map((s) => {
                const c = m.get(s.key)![i]!;
                return <Cell key={s.key} evs={c.events} gap={c.gap} now={now} />;
              })}
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}
const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

function MonthView({ anchor, events, keyOf, series, now, onPick }: { anchor: Date; events: Ev[]; keyOf: Map<string, string>; series: Series[]; now: Date; onPick: (z: Zoom, d: Date) => void }) {
  const p = periodOf('month', anchor);
  const weeks = weeksIn(p);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const evs = events.filter((e) => startsIn(e, p));
  const today = new Date();
  return (
    <>
      <div className="card month-grid" role="grid" aria-label={periodLabel('month', anchor)}>
        {WEEKDAYS.map((d) => (
          <span key={d} className="mg-h">
            {d}
          </span>
        ))}
        {weeks.flatMap((w) =>
          Array.from({ length: 7 }, (_, i) => {
            const d = addDays(w, i);
            const dayEvs = evs.filter((e) => sameDay(new Date(e.startsAt), d));
            const out = d < p.start || d >= p.end;
            return (
              <button key={d.getTime()} className={`mg-d${out ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}`} onClick={() => onPick('week', d)} aria-label={`${dm(d)}: ${dayEvs.length} buổi`}>
                <span>{d.getDate()}</span>
                <span className="mg-dots">
                  {dayEvs.slice(0, 3).map((e) => (
                    <SeriesDot key={e.id} s={byKey.get(keyOf.get(e.id) ?? '')} />
                  ))}
                </span>
              </button>
            );
          }),
        )}
      </div>
      {weeks.map((w) => {
        const list = evs.filter((e) => startsIn(e, { start: w, end: addDays(w, 7) }));
        if (!list.length) return null;
        return (
          <section key={w.getTime()} className="card">
            <div className="row spread">
              <button className="link-button" onClick={() => onPick('week', w)}>
                <h2>
                  Tuần {dm(w)}–{dm(addDays(w, 6))}
                </h2>
              </button>
              <span className="hint small">{list.length} buổi</span>
            </div>
            <EventList events={list} keyOf={keyOf} byKey={byKey} now={now} />
          </section>
        );
      })}
      {!evs.length && <Empty text="Không có buổi nào trong tháng này." />}
    </>
  );
}

function WeekView({ anchor, events, keyOf, series, now, onPick }: { anchor: Date; events: Ev[]; keyOf: Map<string, string>; series: Series[]; now: Date; onPick: (z: Zoom, d: Date) => void }) {
  const p = periodOf('week', anchor);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const evs = events.filter((e) => startsIn(e, p));
  const today = new Date();
  return (
    <>
      <div className="week-strip">
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(p.start, i);
          const n = evs.filter((e) => sameDay(new Date(e.startsAt), d));
          return (
            <button key={i} className={`ws-d${sameDay(d, anchor) ? ' on' : ''}${sameDay(d, today) ? ' today' : ''}`} onClick={() => onPick('week', d)}>
              <span>{WEEKDAYS[i]}</span>
              <b>{d.getDate()}</b>
              <span className="mg-dots">
                {n.slice(0, 3).map((e) => (
                  <SeriesDot key={e.id} s={byKey.get(keyOf.get(e.id) ?? '')} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(p.start, i);
        const list = evs.filter((e) => sameDay(new Date(e.startsAt), d));
        if (!list.length) return null;
        return (
          <section key={i} className="card">
            <h2>
              {['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chúa Nhật'][weekdayOf(d)]} {dm(d)}
            </h2>
            <EventList events={list} keyOf={keyOf} byKey={byKey} now={now} detail />
          </section>
        );
      })}
      {!evs.length && <Empty text="Không có buổi nào trong tuần này." />}
    </>
  );
}

function EventList({ events, keyOf, byKey, now, detail }: { events: Ev[]; keyOf: Map<string, string>; byKey: Map<string, Series>; now: Date; detail?: boolean }) {
  return (
    <ul className="list">
      {events.map((e) => {
        const st = statusOf(e, now);
        const s = byKey.get(keyOf.get(e.id) ?? '');
        return (
          <li key={e.id}>
            <a className="cell-link" href={href({ name: 'event', id: e.id })}>
              <span className="time-tile">
                <b>{timeLabel(e.startsAt)}</b>
                <span>{detail ? timeLabel(e.endsAt) : `${WEEKDAYS[weekdayOf(new Date(e.startsAt))]} ${dm(new Date(e.startsAt))}`}</span>
              </span>
              <SeriesDot s={s} />
              <span className="grid">
                <strong className={st === 'cancelled' ? 'struck' : undefined}>{e.title}</strong>
                <span className="hint small">
                  {s && s.key !== ONE_OFF ? `Nhịp ${seriesWhen(s)}` : 'Buổi lẻ'}
                  {detail && e.slotsTotal > 0 ? ` · ${e.slotsFilled}/${e.slotsTotal} vị trí` : ''}
                </span>
              </span>
              <span className={`tag ${st === 'short' ? 'warn' : st === 'ok' ? 'ok' : st === 'draft' ? 'info' : ''}`}>{statusLabel(e, st)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const Empty = ({ text }: { text: string }) => (
  <section className="card empty-state">
    <Icon name="calendar" size={40} />
    <p>{text}</p>
  </section>
);

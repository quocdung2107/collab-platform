import type { EventSeriesDto, PlanPeriodDto } from '@collab/shared';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { timeLabel } from '@collab/client';
import {
  ONE_OFF,
  WEEKDAYS,
  addDays,
  attention,
  buildSeries,
  dm,
  matrix,
  occurrenceItems,
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
  type Ev,
  type Series,
  type Stats,
  type Zoom,
} from '@collab/client';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useAction, useLoad } from '@collab/client';
import { Icon } from '../ui/icons';
import { Banner, Segmented, Sheet, Skeleton, useMedia } from '../ui/kit';
import { NewSeriesSheet, OccurrenceSheet, PeriodSheet, RepeatMonthSheet, RepeatWeekSheet, SeriesSheet, ymd } from './PlannerSheets';

/**
 * Lập lịch nhiều cấp (AD-32, UX §4.5b): bốn mức Năm/Quý/Tháng/Tuần (L1), cây tổng quan (L2), bảng Nhịp và
 * Giai đoạn (L3). Nhịp đã lưu cho ra buổi "dự kiến" (P3), chỉ thành bản nháp khi bấm; ngoại lệ và chỗ trùng (P4);
 * sửa nhịp theo phạm vi (P5). Buổi chưa thuộc nhịp nào vẫn được gom suy ra (IN-53).
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

type SheetState =
  | { kind: 'tree' | 'series' | 'add' | 'newSeries' | 'repeatWeek' | 'repeatMonth' }
  | { kind: 'occ'; item: Ev }
  | { kind: 'editSeries'; series: EventSeriesDto }
  | { kind: 'period'; period?: PlanPeriodDto };

export function Planner({ orgId, meId }: { orgId: string; meId: string }) {
  const [zoom, setZoomState] = useState<Zoom>(() => (ZOOMS.some((z) => z.value === read(ZOOM_KEY)) ? (read(ZOOM_KEY) as Zoom) : 'quarter'));
  const [anchor, setAnchor] = useState(() => new Date());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(JSON.parse(read(hiddenKey(orgId)) ?? '[]') as string[]));
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showTree = useMedia('(min-width: 1200px)');
  const showSeries = useMedia('(min-width: 1600px)');
  const wide = useMedia('(min-width: 720px)');
  const year = anchor.getFullYear();
  const range = yearFetchRange(year);
  const events = useLoad(() => api.events(orgId, { from: range.start.toISOString(), to: range.end.toISOString() }), [orgId, year]);
  // Kế hoạch (giai đoạn, nhịp, buổi dự kiến): chỉ người lập lịch; lỗi quyền thì vẫn xem buổi như P1.
  const plan = useLoad(() => api.plan(orgId, ymd(range.start), ymd(addDays(range.end, -1))).catch(() => null), [orgId, year]);
  const reload = useCallback(() => (events.reload(), plan.reload()), [events.reload, plan.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime([`user:${meId}`], reload);
  const now = new Date();
  const canPlan = !!plan.data;
  const periods = plan.data?.periods ?? [];
  const yearEnd = `${year}-12-31`;
  const done = (msg?: string) => (setSheet(null), setNotice(msg ?? null), reload());

  const close = useCallback(() => setSheet(null), []);
  const setZoom = (z: Zoom) => (setZoomState(z), write(ZOOM_KEY, z));
  const pick = useCallback((z: Zoom, d: Date) => (setZoomState(z), write(ZOOM_KEY, z), setAnchor(d), setSheet(null)), []);
  const openOcc = useCallback((item: Ev) => setSheet({ kind: 'occ', item }), []);
  const toggle = (key: string) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(hiddenKey(orgId), JSON.stringify([...next]));
      return next;
    });
  const showAll = () => (setHidden(new Set()), write(hiddenKey(orgId), '[]'));

  const all = useMemo<Ev[]>(() => [...(events.data ?? []), ...occurrenceItems(plan.data?.occurrences ?? [])], [events.data, plan.data]);
  const index = useMemo(() => buildSeries(all, plan.data?.series ?? []), [all, plan.data]);
  const visible = all.filter((e) => !hidden.has(index.keyOf.get(e.id) ?? ''));
  const shownSeries = index.series.filter((s) => !hidden.has(s.key));
  const period = periodOf(zoom, anchor);
  const inPeriod = visible.filter((e) => startsIn(e, period));
  const sum = stats(inPeriod, now);
  const pending = inPeriod.filter((e) => e.occurrence?.state === 'projected' && !e.occurrence.conflict && new Date(e.endsAt) > now && index.series.find((s) => s.key === `s:${e.seriesId}`)?.real?.canManage);
  const act = useAction();
  const materialize = () =>
    act.run(
      () => api.materialize(orgId, { from: ymd(period.start), to: ymd(addDays(period.end, -1)), seriesIds: [...new Set(pending.map((e) => e.seriesId!))] }),
      (r) => done(`Đã tạo ${r.created} bản nháp${r.skippedConflicts ? `; ${r.skippedConflicts} buổi trùng chờ bạn quyết` : ''}. Bản nháp chưa ai thấy cho tới khi gửi.`),
    );

  const tree = <Tree year={year} events={visible} now={now} zoom={zoom} anchor={anchor} onPick={pick} />;
  const seriesPanel = (
    <SeriesPanel
      series={index.series}
      hidden={hidden}
      onToggle={toggle}
      onShowAll={showAll}
      canPlan={canPlan}
      periods={periods}
      onEdit={(s) => setSheet({ kind: 'editSeries', series: s })}
      onPeriod={(p) => setSheet({ kind: 'period', period: p })}
      onNewSeries={() => setSheet({ kind: 'newSeries' })}
    />
  );

  return (
    <div className={`planner${showTree ? ' with-tree' : ''}${showSeries ? ' with-series' : ''}`}>
      {showTree && <aside className="plan-side card">{tree}</aside>}
      <div className="plan-main">
        <Segmented label="Mức xem" value={zoom} options={ZOOMS} onChange={setZoom} />
        <div className="plan-nav">
          <button className="icon-button" aria-label="Trước" onClick={() => setAnchor(shift(zoom, anchor, -1))}>
            <Icon name="back" size={22} />
          </button>
          <button className="plan-crumb" onClick={() => !showTree && setSheet({ kind: 'tree' })} aria-label="Mở tổng quan">
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
            <button className="button small" onClick={() => setSheet({ kind: 'series' })}>
              Nhịp{hidden.size ? ` (ẩn ${hidden.size})` : ''}
            </button>
          )}
        </div>
        <SummaryChips s={sum} />
        {canPlan && (
          <div className="plan-actions">
            {pending.length > 0 && (
              <button className="button small primary" disabled={act.busy} onClick={materialize}>
                Tạo {pending.length} bản nháp
              </button>
            )}
            {zoom === 'week' && (
              <button className="button small" onClick={() => setSheet({ kind: 'repeatWeek' })}>
                Lặp tuần này…
              </button>
            )}
            {zoom === 'month' && (
              <button className="button small" onClick={() => setSheet({ kind: 'repeatMonth' })}>
                Lặp tháng này…
              </button>
            )}
            <button className="button small" onClick={() => setSheet({ kind: 'add' })}>
              + Thêm
            </button>
          </div>
        )}
        {notice && (
          <Banner tone="ok">
            <span className="row spread">
              <span className="grow">{notice}</span>
              <button className="link-button" onClick={() => setNotice(null)}>
                Đóng
              </button>
            </span>
          </Banner>
        )}
        {act.error && <p className="error">{act.error}</p>}
        {events.error && <p className="error">{events.error}</p>}
        {!events.data && !events.error && <Skeleton rows={4} />}
        {events.data && all.length >= 1000 && <p className="hint small">Năm này có hơn 1000 buổi; chỉ hiện 1000 buổi đầu.</p>}
        {events.data &&
          (zoom === 'year' ? (
            <YearView year={year} events={visible} periods={periods} now={now} onPick={pick} onPeriod={(p) => setSheet({ kind: 'period', period: p })} />
          ) : zoom === 'quarter' ? (
            <QuarterView weeks={weeksIn(period)} series={shownSeries} events={visible} keyOf={index.keyOf} periods={periods} now={now} wide={wide} onPick={pick} onOcc={openOcc} />
          ) : zoom === 'month' ? (
            <MonthView anchor={anchor} events={visible} keyOf={index.keyOf} series={index.series} periods={periods} now={now} onPick={pick} onOcc={openOcc} />
          ) : (
            <WeekView anchor={anchor} events={visible} keyOf={index.keyOf} series={index.series} periods={periods} now={now} onPick={pick} onOcc={openOcc} />
          ))}
      </div>
      {showSeries && <aside className="plan-side card">{seriesPanel}</aside>}
      {sheet?.kind === 'tree' && (
        <Sheet title={`Tổng quan ${year}`} onClose={close}>
          {tree}
        </Sheet>
      )}
      {sheet?.kind === 'series' && (
        <Sheet title="Nhịp và giai đoạn" onClose={close}>
          {seriesPanel}
        </Sheet>
      )}
      {sheet?.kind === 'add' && (
        <Sheet title="Thêm vào kế hoạch" onClose={close}>
          <div className="grid">
            <button className="button" onClick={() => setSheet({ kind: 'newSeries' })}>
              Nhịp mới từ mẫu
            </button>
            <button className="button" onClick={() => (pick('week', zoom === 'week' ? anchor : new Date()), setSheet({ kind: 'repeatWeek' }))}>
              Lặp một tuần có sẵn…
            </button>
            <button className="button" onClick={() => (pick('month', zoom === 'month' ? anchor : new Date()), setSheet({ kind: 'repeatMonth' }))}>
              Lặp một tháng có sẵn…
            </button>
            <button className="button" onClick={() => setSheet({ kind: 'period' })}>
              Giai đoạn hoặc ngày đặc biệt
            </button>
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'newSeries' && <NewSeriesSheet orgId={orgId} defaultStart={period.start < now ? now : period.start} yearEnd={yearEnd} onDone={done} onClose={close} />}
      {sheet?.kind === 'repeatWeek' && <RepeatWeekSheet orgId={orgId} events={all.filter((e) => startsIn(e, periodOf('week', anchor)))} yearEnd={yearEnd} onDone={done} onClose={close} />}
      {sheet?.kind === 'repeatMonth' && <RepeatMonthSheet orgId={orgId} month={periodOf('month', anchor).start} yearEnd={yearEnd} onDone={done} onClose={close} />}
      {sheet?.kind === 'period' && <PeriodSheet orgId={orgId} period={sheet.period} defaultStart={period.start} onDone={done} onClose={close} />}
      {sheet?.kind === 'occ' && (
        <OccurrenceSheet
          item={sheet.item}
          orgId={orgId}
          series={plan.data?.series.find((s) => s.id === sheet.item.seriesId)}
          onDone={done}
          onClose={close}
          onEditSeries={(s) => setSheet({ kind: 'editSeries', series: s })}
        />
      )}
      {sheet?.kind === 'editSeries' && <SeriesSheet series={plan.data?.series.find((s) => s.id === sheet.series.id) ?? sheet.series} periods={periods} onDone={done} onClose={close} />}
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
      {s.conflict > 0 && <span className="tag warn">{s.conflict} cần quyết</span>}
      {s.projected > 0 && <span className="tag dashed">{s.projected} dự kiến</span>}
      {s.cancelled > 0 && <span className="tag">{s.cancelled} đã huỷ</span>}
    </div>
  );
}

const Attn = ({ s }: { s: Stats }) =>
  s.short + s.conflict > 0 ? <span className="tag warn">{attention(s)}</span> : s.draft > 0 ? <span className="tag info">{s.draft}</span> : s.total > 0 ? <span className="tag ok">{s.total}</span> : null;

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

function SeriesPanel({
  series,
  hidden,
  onToggle,
  onShowAll,
  canPlan,
  periods,
  onEdit,
  onPeriod,
  onNewSeries,
}: {
  series: Series[];
  hidden: Set<string>;
  onToggle: (k: string) => void;
  onShowAll: () => void;
  canPlan: boolean;
  periods: PlanPeriodDto[];
  onEdit: (s: EventSeriesDto) => void;
  onPeriod: (p?: PlanPeriodDto) => void;
  onNewSeries: () => void;
}) {
  const real = series.filter((s) => s.real);
  const inferred = series.filter((s) => !s.real);
  const row = (s: Series) => (
    <li key={s.key} className="series-li">
      <label className="series-row">
        <input type="checkbox" checked={!hidden.has(s.key)} onChange={() => onToggle(s.key)} aria-label={`Hiện ${s.title}`} />
        <SeriesDot s={s} />
        <span className="grid grow">
          <strong>{s.title}</strong>
          <span className="hint small">
            {seriesWhen(s)}
            {s.real ? (s.real.variants.length ? ` · ${s.real.variants.length} ngoại lệ` : '') : ` · ${s.count} buổi`}
          </span>
        </span>
      </label>
      {s.real && (
        <button className="button small" onClick={() => onEdit(s.real!)}>
          {s.real.canManage ? 'Sửa' : 'Xem'}
        </button>
      )}
    </li>
  );
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="row spread">
        <h2 className="plan-h">Nhịp</h2>
        <span className="row">
          {hidden.size > 0 && (
            <button className="button small" onClick={onShowAll}>
              Hiện tất cả
            </button>
          )}
          {canPlan && (
            <button className="button small" onClick={onNewSeries}>
              + Nhịp
            </button>
          )}
        </span>
      </div>
      {series.length === 0 && <p className="hint small">Chưa có buổi nào trong năm này.</p>}
      {real.length > 0 && <ul className="list">{real.map(row)}</ul>}
      {inferred.length > 0 && (
        <>
          {real.length > 0 && <span className="hint small">Gom từ buổi chưa thuộc nhịp</span>}
          <ul className="list">{inferred.map(row)}</ul>
          <p className="hint small">Các dòng này gom buổi cùng mẫu (hoặc cùng tên), cùng thứ và giờ. Dùng "Lặp tuần này" hoặc "Lặp tháng này" để biến chúng thành nhịp.</p>
        </>
      )}
      {canPlan && (
        <>
          <div className="row spread">
            <h2 className="plan-h">Giai đoạn</h2>
            <button className="button small" onClick={() => onPeriod()}>
              + Giai đoạn
            </button>
          </div>
          {!periods.length && <p className="hint small">Chưa có. Giai đoạn đặt tên cho một khoảng (Mùa Vọng, Hè, Quý 1) hoặc một ngày đặc biệt.</p>}
          <ul className="list">
            {periods.map((p) => (
              <li key={p.id}>
                <button className="cell-link" onClick={() => onPeriod(p)}>
                  <i className={`pband-dot pc-${p.color}`} aria-hidden="true" />
                  <span className="grid grow">
                    <strong>
                      {p.kind === 'special_day' ? '★ ' : ''}
                      {p.name}
                    </strong>
                    <span className="hint small">{p.kind === 'special_day' ? dmyStr(p.startsOn) : `${dmyStr(p.startsOn)} – ${dmyStr(p.endsOn)}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const dmyStr = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d}/${m}/${y}`;
};
/** Giai đoạn và ngày đặc biệt chạm khoảng [start, end). */
const periodsIn = (periods: PlanPeriodDto[], p: { start: Date; end: Date }) => periods.filter((x) => x.startsOn < ymd(p.end) && x.endsOn >= ymd(p.start));
const PeriodChips = ({ list, onPeriod }: { list: PlanPeriodDto[]; onPeriod?: (p: PlanPeriodDto) => void }) =>
  list.length ? (
    <span className="plan-chips">
      {list.map((p) =>
        onPeriod ? (
          <span
            key={p.id}
            role="button"
            tabIndex={0}
            className={`pchip pc-${p.color}`}
            onClick={(e) => (e.stopPropagation(), onPeriod(p))}
            onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onPeriod(p))}
          >
            {p.kind === 'special_day' ? `★ ${p.name} ${dmyStr(p.startsOn).slice(0, -5)}` : p.name}
          </span>
        ) : (
          <span key={p.id} className={`pchip pc-${p.color}`}>
            {p.kind === 'special_day' ? `★ ${p.name} ${dmyStr(p.startsOn).slice(0, -5)}` : p.name}
          </span>
        ),
      )}
    </span>
  ) : null;

const SeriesDot = ({ s }: { s: Series | undefined }) => <i className={`sdot c${s && s.color >= 0 ? s.color : 'x'}`} aria-hidden="true" />;

// ---------------------------------------------------------------- L1: bốn mức

function YearView({
  year,
  events,
  periods,
  now,
  onPick,
  onPeriod,
}: {
  year: number;
  events: Ev[];
  periods: PlanPeriodDto[];
  now: Date;
  onPick: (z: Zoom, d: Date) => void;
  onPeriod: (p: PlanPeriodDto) => void;
}) {
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
            <PeriodChips list={periodsIn(periods, p)} onPeriod={onPeriod} />
            <span className="plan-chips">
              {s.conflict > 0 && <span className="tag warn">{s.conflict} cần quyết</span>}
              {s.short > 0 && <span className="tag warn">{s.short} thiếu</span>}
              {s.draft > 0 && <span className="tag info">{s.draft} nháp</span>}
              {s.projected > 0 && <span className="tag dashed">{s.projected} dự kiến</span>}
              {attention(s) === 0 && s.projected === 0 && s.total > 0 && <span className="tag ok">ổn</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Cell({ evs, gap, now, onOcc }: { evs: Ev[]; gap: boolean; now: Date; onOcc: (e: Ev) => void }) {
  if (!evs.length) return gap ? <span className="pcell s-gap" title="Tuần trống giữa các buổi của nhịp này">trống</span> : <span className="pcell s-none" />;
  const e = evs[0]!;
  const st = statusOf(e, now);
  if (e.occurrence)
    return (
      <button className={`pcell s-${st}`} onClick={() => onOcc(e)} title={`${e.title} · ${dm(new Date(e.startsAt))} ${timeLabel(e.startsAt)} · ${statusLabel(e, st)}`}>
        {st === 'conflict' ? '!' : st === 'skipped' ? '–' : dm(new Date(e.startsAt))}
        {evs.length > 1 && <small> +{evs.length - 1}</small>}
      </button>
    );
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
  periods,
  onPick,
  onOcc,
}: {
  weeks: Date[];
  series: Series[];
  events: Ev[];
  keyOf: Map<string, string>;
  now: Date;
  wide: boolean;
  periods: PlanPeriodDto[];
  onPick: (z: Zoom, d: Date) => void;
  onOcc: (e: Ev) => void;
}) {
  const m = matrix(weeks, series, events, keyOf);
  const thisWeek = startOfWeek(now).getTime();
  if (!series.length) return <Empty text="Không có buổi nào trong quý này (hoặc mọi nhịp đang ẩn)." />;
  const weekBtn = (w: Date) => {
    const special = periodsIn(periods, { start: w, end: addDays(w, 7) }).filter((p) => p.kind === 'special_day');
    return (
      <button className={`pweek${w.getTime() === thisWeek ? ' now' : ''}`} onClick={() => onPick('week', w)} title={special.map((p) => p.name).join(', ') || undefined}>
        {dm(w)}
        {special.length > 0 && <i className={`pstar pc-${special[0]!.color}`}>★</i>}
      </button>
    );
  };
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
  const bands = periodsIn(periods, { start: weeks[0]!, end: addDays(weeks.at(-1)!, 7) });
  return (
    <>
    <PeriodChips list={bands} />
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
                <Cell key={i} evs={c.events} gap={c.gap} now={now} onOcc={onOcc} />
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
                return <Cell key={s.key} evs={c.events} gap={c.gap} now={now} onOcc={onOcc} />;
              })}
            </Row>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

type ListProps = { anchor: Date; events: Ev[]; keyOf: Map<string, string>; series: Series[]; periods: PlanPeriodDto[]; now: Date; onPick: (z: Zoom, d: Date) => void; onOcc: (e: Ev) => void };

function MonthView({ anchor, events, keyOf, series, periods, now, onPick, onOcc }: ListProps) {
  const p = periodOf('month', anchor);
  const weeks = weeksIn(p);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const evs = events.filter((e) => startsIn(e, p));
  const today = new Date();
  const special = new Map(periods.filter((x) => x.kind === 'special_day').map((x) => [x.startsOn, x]));
  return (
    <>
      <PeriodChips list={periodsIn(periods, p)} />
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
            const sd = special.get(ymd(d));
            return (
              <button
                key={d.getTime()}
                className={`mg-d${out ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}${sd ? ` special pc-${sd.color}` : ''}`}
                onClick={() => onPick('week', d)}
                aria-label={`${dm(d)}${sd ? ` (${sd.name})` : ''}: ${dayEvs.length} buổi`}
                title={sd?.name}
              >
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
            <EventList events={list} keyOf={keyOf} byKey={byKey} now={now} onOcc={onOcc} />
          </section>
        );
      })}
      {!evs.length && <Empty text="Không có buổi nào trong tháng này." />}
    </>
  );
}

function WeekView({ anchor, events, keyOf, series, periods, now, onPick, onOcc }: ListProps) {
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
        const sd = periods.find((x) => x.kind === 'special_day' && x.startsOn === ymd(d));
        if (!list.length && !sd) return null;
        return (
          <section key={i} className="card">
            <h2>
              {['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chúa Nhật'][weekdayOf(d)]} {dm(d)}
              {sd && <span className={`pchip pc-${sd.color}`}>★ {sd.name}</span>}
            </h2>
            {list.length > 0 && <EventList events={list} keyOf={keyOf} byKey={byKey} now={now} onOcc={onOcc} detail />}
          </section>
        );
      })}
      {!evs.length && <Empty text="Không có buổi nào trong tuần này." />}
    </>
  );
}

function EventList({ events, keyOf, byKey, now, detail, onOcc }: { events: Ev[]; keyOf: Map<string, string>; byKey: Map<string, Series>; now: Date; detail?: boolean; onOcc: (e: Ev) => void }) {
  return (
    <ul className="list">
      {events.map((e) => {
        const st = statusOf(e, now);
        const s = byKey.get(keyOf.get(e.id) ?? '');
        const Tag = e.occurrence ? 'button' : 'a';
        return (
          <li key={e.id}>
            <Tag className={`cell-link${e.occurrence ? ` occ s-${st}` : ''}`} {...(e.occurrence ? { onClick: () => onOcc(e) } : { href: href({ name: 'event', id: e.id }) })}>
              <span className="time-tile">
                <b>{timeLabel(e.startsAt)}</b>
                <span>{detail ? timeLabel(e.endsAt) : `${WEEKDAYS[weekdayOf(new Date(e.startsAt))]} ${dm(new Date(e.startsAt))}`}</span>
              </span>
              <SeriesDot s={s} />
              <span className="grid">
                <strong className={st === 'cancelled' || st === 'skipped' ? 'struck' : undefined}>{e.title}</strong>
                <span className="hint small">
                  {s && s.key !== ONE_OFF ? `Nhịp ${seriesWhen(s)}` : 'Buổi lẻ'}
                  {detail && e.slotsTotal > 0 ? ` · ${e.slotsFilled}/${e.slotsTotal} vị trí` : ''}
                </span>
              </span>
              <span className={`tag ${st === 'short' || st === 'conflict' ? 'warn' : st === 'ok' ? 'ok' : st === 'draft' ? 'info' : st === 'projected' ? 'dashed' : ''}`}>{statusLabel(e, st)}</span>
            </Tag>
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

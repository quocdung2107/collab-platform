import { ruleLabel, ruleWeekday, weekdayIso, type EventSeriesDto, type EventSummaryDto, type OccurrenceDto } from '@collab/shared';

/**
 * Lập lịch nhiều cấp, bước P1 (AD-32, IN-53): hàm thuần tính khoảng thời gian, "nhịp" suy ra, trạng thái và
 * số liệu cho bốn mức Năm/Quý/Tháng/Tuần và cây tổng quan. Ngày theo giờ máy; tuần bắt đầu thứ Hai.
 */
export type Zoom = 'year' | 'quarter' | 'month' | 'week';
export type CellStatus = 'past' | 'ok' | 'short' | 'draft' | 'cancelled' | 'projected' | 'skipped' | 'conflict';
export type Ev = Pick<EventSummaryDto, 'id' | 'title' | 'startsAt' | 'endsAt' | 'status' | 'templateId' | 'slotsTotal' | 'slotsFilled'> & {
  seriesId?: string | null;
  /** Buổi của nhịp chưa tạo (P3): dự kiến hoặc bỏ qua; không có trang Buổi. */
  occurrence?: OccurrenceDto;
};

export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;
/** Thứ trong tuần, 0 = thứ Hai … 6 = Chúa Nhật. */
export const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Cộng ngày theo lịch (an toàn với giờ mùa hè, khác cộng 24 giờ). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -weekdayOf(d));
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dm = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;

export interface Period {
  start: Date;
  /** Không gồm. */
  end: Date;
}

export function periodOf(zoom: Zoom, anchor: Date): Period {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  switch (zoom) {
    case 'year':
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
    case 'quarter': {
      const q = Math.floor(m / 3) * 3;
      return { start: new Date(y, q, 1), end: new Date(y, q + 3, 1) };
    }
    case 'month':
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    case 'week': {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 7) };
    }
  }
}

/** Lùi/tới một đơn vị của mức đang xem; giữ ngày 1 với tháng/quý/năm để không trượt tháng (31/1 + 1 tháng). */
export function shift(zoom: Zoom, anchor: Date, dir: -1 | 1): Date {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  switch (zoom) {
    case 'year':
      return new Date(y + dir, m, 1);
    case 'quarter':
      return new Date(y, m + 3 * dir, 1);
    case 'month':
      return new Date(y, m + dir, 1);
    case 'week':
      return addDays(anchor, 7 * dir);
  }
}

export function periodLabel(zoom: Zoom, anchor: Date): string {
  const p = periodOf(zoom, anchor);
  const y = anchor.getFullYear();
  switch (zoom) {
    case 'year':
      return `Năm ${y}`;
    case 'quarter':
      return `Q${Math.floor(anchor.getMonth() / 3) + 1}/${y}`;
    case 'month':
      return `Tháng ${anchor.getMonth() + 1}/${y}`;
    case 'week':
      return `${dm(p.start)}–${dm(addDays(p.end, -1))}`;
  }
}

/** Các thứ Hai của những tuần giao với khoảng [start, end). */
export function weeksIn(p: Period): Date[] {
  const out: Date[] = [];
  for (let w = startOfWeek(p.start); w < p.end; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Khoảng cần tải cho một năm: đủ các tuần chạm 1/1 và 31/12. */
export function yearFetchRange(year: number): Period {
  return { start: startOfWeek(new Date(year, 0, 1)), end: addDays(startOfWeek(new Date(year, 11, 31)), 7) };
}

export const startsIn = (e: Ev, p: Period) => {
  const t = new Date(e.startsAt);
  return t >= p.start && t < p.end;
};

export function statusOf(e: Ev, now: Date): CellStatus {
  if (e.occurrence) return e.occurrence.state === 'skipped' ? 'skipped' : e.occurrence.conflict ? 'conflict' : 'projected';
  if (e.status === 'cancelled') return 'cancelled';
  if (new Date(e.endsAt) <= now) return 'past';
  if (e.status === 'draft') return 'draft';
  return e.slotsFilled < e.slotsTotal ? 'short' : 'ok';
}

export const statusLabel = (e: Ev, s: CellStatus) =>
  s === 'projected' ? 'dự kiến' : s === 'skipped' ? 'bỏ qua' : s === 'conflict' ? 'cần quyết' :
  s === 'past' ? 'đã qua' : s === 'cancelled' ? 'đã huỷ' : s === 'draft' ? 'nháp' : s === 'short' ? `thiếu ${e.slotsTotal - e.slotsFilled}` : 'đủ';

// ---------------------------------------------------------------- nhịp suy ra (P1)

/** Hàng "buổi lẻ": nhịp chỉ có một buổi trong khoảng đã tải. */
export const ONE_OFF = 'le';

export interface Series {
  key: string;
  title: string;
  /** 0 = thứ Hai; -1 cho hàng buổi lẻ. */
  weekday: number;
  time: string;
  count: number;
  /** Chỉ số màu 0..5. */
  color: number;
  /** Nhịp đã lưu (P3); không có = nhịp suy ra từ buổi cũ. */
  real?: EventSeriesDto;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const normTitle = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Khoá nhịp: mẫu (nếu có) hoặc tên chuẩn hoá, cùng thứ và giờ bắt đầu. P3 thay bằng `series_id`. */
export function rawSeriesKey(e: Ev): string {
  const d = new Date(e.startsAt);
  return `${e.templateId ? `t:${e.templateId}` : `n:${normTitle(e.title)}`}|${weekdayOf(d)}|${hhmm(d)}`;
}

/** Buổi dự kiến/bỏ qua của nhịp → dạng Ev để đi chung ma trận, danh sách, số liệu. */
export function occurrenceItems(occ: OccurrenceDto[]): Ev[] {
  return occ
    .filter((o) => o.state !== 'materialized')
    .map((o) => ({
      id: `occ:${o.seriesId}:${o.date}`,
      title: o.title,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      status: 'draft' as const,
      templateId: null,
      slotsTotal: 0,
      slotsFilled: 0,
      seriesId: o.seriesId,
      occurrence: o,
    }));
}

export interface SeriesIndex {
  series: Series[];
  keyOf: Map<string, string>;
}

/**
 * Gom buổi thành nhịp. Nhịp đã lưu (theo seriesId) đứng trước; buổi chưa thuộc nhịp nào được gom suy ra (IN-53);
 * nhịp suy ra có một buổi gom vào hàng "Buổi lẻ" ở cuối. Thứ tự trong mỗi nhóm: thứ trong tuần rồi giờ.
 */
export function buildSeries(events: Ev[], real: EventSeriesDto[] = []): SeriesIndex {
  const groups = new Map<string, Ev[]>();
  const keyOf = new Map<string, string>();
  const known = new Set(real.map((s) => s.id));
  const realRows: Series[] = real.map((s) => ({
    key: `s:${s.id}`,
    title: s.name,
    weekday: ruleWeekday(s.rule) ?? weekdayIso(s.startsOn),
    time: s.localTime,
    count: 0,
    color: 0,
    real: s,
  }));
  for (const e of events) {
    if (e.seriesId && known.has(e.seriesId)) {
      keyOf.set(e.id, `s:${e.seriesId}`);
      realRows.find((r) => r.key === `s:${e.seriesId}`)!.count++;
      continue;
    }
    const k = rawSeriesKey(e);
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const series: Series[] = [];
  let singles = 0;
  for (const [k, evs] of groups) {
    if (evs.length < 2) {
      keyOf.set(evs[0]!.id, ONE_OFF);
      singles++;
      continue;
    }
    for (const e of evs) keyOf.set(e.id, k);
    const titles = new Map<string, number>();
    for (const e of evs) titles.set(e.title, (titles.get(e.title) ?? 0) + 1);
    const title = [...titles].sort((a, b) => b[1] - a[1])[0]![0];
    const d = new Date(evs[0]!.startsAt);
    series.push({ key: k, title, weekday: weekdayOf(d), time: hhmm(d), count: evs.length, color: 0 });
  }
  const order = (a: Series, b: Series) => a.weekday - b.weekday || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'vi');
  realRows.sort(order);
  series.sort(order);
  series.unshift(...realRows);
  series.forEach((s, i) => (s.color = i % 6));
  if (singles) series.push({ key: ONE_OFF, title: 'Buổi lẻ', weekday: -1, time: '', count: singles, color: -1 });
  return { series, keyOf };
}

export const seriesWhen = (s: Series) => (s.real ? `${ruleLabel(s.real.rule)} ${s.time}` : s.weekday < 0 ? 'chỉ một lần' : `${WEEKDAYS[s.weekday]} ${s.time}`);

// ---------------------------------------------------------------- số liệu

export interface Stats {
  total: number;
  draft: number;
  short: number;
  cancelled: number;
  past: number;
  ok: number;
  projected: number;
  skipped: number;
  conflict: number;
}
/** Cần người lập lịch để ý: nháp chưa gửi, thiếu người, chỗ trùng chưa quyết. */
export const attention = (s: Stats) => s.draft + s.short + s.conflict;

export function stats(events: Ev[], now: Date): Stats {
  const s: Stats = { total: 0, draft: 0, short: 0, cancelled: 0, past: 0, ok: 0, projected: 0, skipped: 0, conflict: 0 };
  for (const e of events) {
    const st = statusOf(e, now);
    // Buổi bỏ qua không tính là một buổi.
    if (st !== 'skipped') s.total++;
    s[st]++;
  }
  return s;
}

/** Trạng thái "tệ nhất" của một nhóm buổi, để tô ô tuần ở mức Năm. */
export function worst(events: Ev[], now: Date): CellStatus | null {
  const order: CellStatus[] = ['conflict', 'short', 'draft', 'projected', 'ok', 'past', 'skipped', 'cancelled'];
  let best: number | null = null;
  for (const e of events) {
    const i = order.indexOf(statusOf(e, now));
    if (best === null || i < best) best = i;
  }
  return best === null ? null : order[best]!;
}

/**
 * Ma trận tuần × nhịp. Ô trống nằm giữa hai tuần có buổi của cùng nhịp (trong khoảng đang xem) được đánh dấu
 * `gap`: thường là tuần quên tạo buổi. Hàng "Buổi lẻ" không có khái niệm tuần trống.
 */
export interface MatrixCell<T extends Ev = Ev> {
  events: T[];
  gap: boolean;
}
export function matrix<T extends Ev>(weeks: Date[], series: Series[], events: T[], keyOf: Map<string, string>): Map<string, MatrixCell<T>[]> {
  const out = new Map<string, MatrixCell<T>[]>();
  for (const s of series) out.set(s.key, weeks.map(() => ({ events: [], gap: false })));
  for (const e of events) {
    const row = out.get(keyOf.get(e.id) ?? '');
    if (!row) continue;
    const w = startOfWeek(new Date(e.startsAt));
    const i = weeks.findIndex((x) => sameDay(x, w));
    if (i >= 0) row[i]!.events.push(e);
  }
  for (const [k, row] of out) {
    if (k === ONE_OFF) continue;
    const filled = row.map((c) => c.events.some((e) => e.status !== 'cancelled' || !!e.occurrence));
    const first = filled.indexOf(true);
    const last = filled.lastIndexOf(true);
    for (let i = first + 1; i < last; i++) if (!filled[i] && !row[i]!.events.length) row[i]!.gap = true;
  }
  return out;
}

// ---------------------------------------------------------------- cây tổng quan (L2)

export interface TreeWeek {
  start: Date;
  stats: Stats;
}
export interface TreeMonth {
  month: number;
  start: Date;
  stats: Stats;
  weeks: TreeWeek[];
}
export interface TreeQuarter {
  quarter: number;
  start: Date;
  stats: Stats;
  months: TreeMonth[];
}
export interface YearTree {
  year: number;
  stats: Stats;
  quarters: TreeQuarter[];
}

export function yearTree(year: number, events: Ev[], now: Date): YearTree {
  const ofPeriod = (p: Period) => events.filter((e) => startsIn(e, p));
  const yearEvents = ofPeriod(periodOf('year', new Date(year, 0, 1)));
  return {
    year,
    stats: stats(yearEvents, now),
    quarters: [0, 1, 2, 3].map((q) => {
      const qStart = new Date(year, q * 3, 1);
      return {
        quarter: q + 1,
        start: qStart,
        stats: stats(ofPeriod(periodOf('quarter', qStart)), now),
        months: [0, 1, 2].map((i) => {
          const mStart = new Date(year, q * 3 + i, 1);
          const mp = periodOf('month', mStart);
          return {
            month: q * 3 + i + 1,
            start: mStart,
            stats: stats(ofPeriod(mp), now),
            weeks: weeksIn(mp).map((w) => ({ start: w, stats: stats(ofPeriod({ start: w, end: addDays(w, 7) }), now) })),
          };
        }),
      };
    }),
  };
}

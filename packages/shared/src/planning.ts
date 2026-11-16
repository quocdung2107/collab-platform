import type { TemplateDefinition } from './scheduling.js';

/**
 * Lập lịch nhiều cấp (AD-32): Giai đoạn, Nhịp, Biến thể. Hàm mở rộng quy tắc là hàm thuần, dùng ở Backend
 * (tính buổi dự kiến, tạo bản nháp) và có thể dùng ở máy khách. Ngày dạng "YYYY-MM-DD" theo lịch của tổ chức,
 * giờ "HH:MM" theo organizations.timezone. Thứ: 0 = thứ Hai … 6 = Chúa Nhật.
 */

export type PeriodKind = 'period' | 'special_day';
export const PERIOD_COLORS = ['green', 'gold', 'blue', 'orange', 'violet', 'red', 'teal', 'gray'] as const;
export type PeriodColor = (typeof PERIOD_COLORS)[number];

export interface PlanPeriodDto {
  id: string;
  name: string;
  kind: PeriodKind;
  startsOn: string;
  endsOn: string;
  color: PeriodColor;
  note: string | null;
  version: number;
}

export type SeriesRule =
  | { freq: 'weekly'; interval: number; weekday: number }
  /** nth: 1..5, -1 = cuối tháng. */
  | { freq: 'monthly'; nth: number; weekday: number }
  | { freq: 'yearly'; month: number; day: number };

export type VariantSelector = { kind: 'date'; date: string } | { kind: 'nth'; nth: number } | { kind: 'period'; periodId: string };
export type VariantAction =
  | { type: 'skip' }
  /** Đã xem chỗ trùng và giữ nguyên ("Giữ cả hai"). */
  | { type: 'keep' }
  | { type: 'override'; title?: string; localTime?: string; definition?: TemplateDefinition };

export interface SeriesVariantDto {
  id: string;
  selector: VariantSelector;
  action: VariantAction;
  createdAt: string;
}

export interface EventSeriesDto {
  id: string;
  name: string;
  rule: SeriesRule;
  localTime: string;
  startsOn: string;
  untilOn: string | null;
  location: string | null;
  definition: TemplateDefinition;
  templateId: string | null;
  version: number;
  variants: SeriesVariantDto[];
  /** Người xem có quyền sửa nhịp (quản trị, hoặc trưởng của mọi nhóm trong định nghĩa). */
  canManage: boolean;
}

export type OccurrenceState = 'projected' | 'skipped' | 'materialized';

export interface OccurrenceDto {
  seriesId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  title: string;
  state: OccurrenceState;
  eventId: string | null;
  /** Biến thể đang áp dụng (nếu có). */
  variantId: string | null;
  /** Chỗ trùng cần người lập lịch quyết (AD-32); null nếu không trùng hoặc đã quyết. */
  conflict: { reason: 'special_day' | 'overlap'; label: string } | null;
}

export interface PlanDto {
  timezone: string;
  canManage: boolean;
  periods: PlanPeriodDto[];
  series: EventSeriesDto[];
  occurrences: OccurrenceDto[];
}

export interface MaterializeResultDto {
  created: number;
  skippedExisting: number;
  /** Buổi trùng chưa quyết: không tạo, chờ người lập lịch chọn. */
  skippedConflicts: number;
  eventIds: string[];
}

/** Đề xuất khi "Lặp tháng này" (P4): mỗi buổi nguồn thành nhịp tuần, nhịp tháng, hoặc biến thể của nhịp tuần cùng giờ. */
export interface MonthProposalDto {
  eventId: string;
  title: string;
  startsAt: string;
  kind: 'weekly' | 'monthly' | 'variant' | 'covered';
  rule: SeriesRule;
  /** kind = variant: buổi nguồn của nhịp tuần mà biến thể gắn vào. */
  variantOfEventId: string | null;
  nth: number;
  /** Số buổi cùng khoá trong tháng nguồn. */
  count: number;
  note: string;
}

export interface SeriesImpactDto {
  projected: number;
  drafts: number;
  detached: number;
  published: number;
  /** Người có Assignment đang hiệu lực ở các buổi đã gửi sẽ đổi. */
  people: number;
}

/** Xem trước khi xoá nhịp cùng các buổi của nó (AD-33). */
export interface SeriesRemovalDto {
  /** Buổi đã tạo, chưa xoá. */
  total: number;
  drafts: number;
  /** Đã công bố, chưa kết thúc: sẽ huỷ và báo người được xếp. */
  upcomingPublished: number;
  /** Đã qua hoặc đã huỷ: ẩn, không báo ai. */
  past: number;
  peopleToNotify: number;
  /** Buổi người gọi không có quyền xoá (cần người phụ trách buổi hoặc quản trị). */
  blocked: number;
}

// ---------------------------------------------------------------- ngày

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const parts = (s: string) => s.split('-').map(Number) as [number, number, number];
export const addDaysIso = (s: string, n: number) => {
  const [y, m, d] = parts(s);
  return isoDate(y, m, d + n);
};
/** 0 = thứ Hai. */
export const weekdayIso = (s: string) => {
  const [y, m, d] = parts(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Lần thứ mấy của thứ này trong tháng (1..5). */
export const nthOfMonth = (s: string) => Math.ceil(parts(s)[2] / 7);
export const isLastOfMonth = (s: string) => {
  const [y, m, d] = parts(s);
  return d + 7 > daysInMonth(y, m);
};
const daysBetween = (a: string, b: string) => {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
};

/** Phút lệch của múi giờ tại một thời điểm (dương = trước UTC). */
function tzOffsetMin(utcMs: number, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs) / 60_000;
}

/** Ngày + giờ địa phương của tổ chức → thời điểm UTC. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMin(guess, timeZone);
  let t = guess - off * 60_000;
  const off2 = tzOffsetMin(t, timeZone);
  if (off2 !== off) t = guess - off2 * 60_000;
  return new Date(t);
}

/** Thời điểm → ngày và giờ địa phương của tổ chức. */
export function utcToZoned(at: Date, timeZone: string): { date: string; time: string } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

// ---------------------------------------------------------------- quy tắc

/** Các ngày của quy tắc trong [from, to] (gồm cả hai đầu), giới hạn bởi startsOn/untilOn. */
export function expandRule(rule: SeriesRule, startsOn: string, untilOn: string | null, from: string, to: string): string[] {
  const lo = from > startsOn ? from : startsOn;
  const hi = untilOn && untilOn < to ? untilOn : to;
  if (lo > hi) return [];
  const out: string[] = [];
  if (rule.freq === 'weekly') {
    const interval = Math.max(1, rule.interval);
    // Lần đầu: ngày đầu tiên từ startsOn có đúng thứ; các lần sau cách interval tuần.
    const first = addDaysIso(startsOn, (rule.weekday - weekdayIso(startsOn) + 7) % 7);
    let k = Math.max(0, Math.ceil(daysBetween(first, lo) / (7 * interval)));
    for (let d = addDaysIso(first, k * 7 * interval); d <= hi; d = addDaysIso(first, ++k * 7 * interval)) if (d >= lo) out.push(d);
    return out;
  }
  const [ly, lm] = parts(lo);
  const [hy, hm] = parts(hi);
  if (rule.freq === 'monthly') {
    for (let y = ly, m = lm; y < hy || (y === hy && m <= hm); m === 12 ? (y++, (m = 1)) : m++) {
      const firstWd = (rule.weekday - weekdayIso(isoDate(y, m, 1)) + 7) % 7;
      let day: number;
      if (rule.nth === -1) {
        day = 1 + firstWd;
        while (day + 7 <= daysInMonth(y, m)) day += 7;
      } else {
        day = 1 + firstWd + 7 * (rule.nth - 1);
        if (day > daysInMonth(y, m)) continue; // tháng không có thứ n
      }
      const d = isoDate(y, m, day);
      if (d >= lo && d <= hi) out.push(d);
    }
    return out;
  }
  for (let y = ly; y <= hy; y++) {
    if (rule.day > daysInMonth(y, rule.month)) continue;
    const d = isoDate(y, rule.month, rule.day);
    if (d >= lo && d <= hi) out.push(d);
  }
  return out;
}

/** Thứ của quy tắc (yearly: không cố định → null). */
export const ruleWeekday = (r: SeriesRule) => (r.freq === 'yearly' ? null : r.weekday);

const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export function ruleLabel(r: SeriesRule): string {
  if (r.freq === 'weekly') return r.interval > 1 ? `${WD[r.weekday]} mỗi ${r.interval} tuần` : `mỗi ${WD[r.weekday]}`;
  if (r.freq === 'monthly') return `${WD[r.weekday]} ${r.nth === -1 ? 'cuối' : `thứ ${r.nth}`} của tháng`;
  return `ngày ${r.day}/${r.month} hằng năm`;
}

/** Độ cụ thể của bộ chọn: ngày > giai đoạn > thứ n của tháng (AD-32). */
const RANK: Record<VariantSelector['kind'], number> = { date: 3, period: 2, nth: 1 };

export function selectorMatches(sel: VariantSelector, date: string, periods: ReadonlyArray<Pick<PlanPeriodDto, 'id' | 'startsOn' | 'endsOn'>>): boolean {
  if (sel.kind === 'date') return sel.date === date;
  if (sel.kind === 'nth') return sel.nth === -1 ? isLastOfMonth(date) : nthOfMonth(date) === sel.nth;
  const p = periods.find((x) => x.id === sel.periodId);
  return !!p && p.startsOn <= date && date <= p.endsOn;
}

/** Biến thể áp dụng cho một ngày: bộ chọn cụ thể nhất; cùng độ cụ thể thì biến thể tạo sau thắng. */
export function variantFor<V extends { selector: VariantSelector; createdAt: string }>(
  variants: readonly V[],
  date: string,
  periods: ReadonlyArray<Pick<PlanPeriodDto, 'id' | 'startsOn' | 'endsOn'>>,
): V | null {
  let best: V | null = null;
  for (const v of variants) {
    if (!selectorMatches(v.selector, date, periods)) continue;
    if (!best || RANK[v.selector.kind] > RANK[best.selector.kind] || (RANK[v.selector.kind] === RANK[best.selector.kind] && v.createdAt >= best.createdAt)) best = v;
  }
  return best;
}

export function selectorLabel(sel: VariantSelector, periods: ReadonlyArray<Pick<PlanPeriodDto, 'id' | 'name'>>): string {
  if (sel.kind === 'date') {
    const [y, m, d] = parts(sel.date);
    return `ngày ${d}/${m}/${y}`;
  }
  if (sel.kind === 'nth') return sel.nth === -1 ? 'lần cuối của tháng' : `lần thứ ${sel.nth} của tháng`;
  return `trong "${periods.find((p) => p.id === sel.periodId)?.name ?? 'giai đoạn đã xoá'}"`;
}

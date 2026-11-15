import { describe, expect, it } from 'vitest';
import { ONE_OFF, addDays, attention, buildSeries, matrix, normTitle, occurrenceItems, periodLabel, periodOf, shift, stats, statusOf, weeksIn, yearFetchRange, yearTree, type Ev } from './planning';

let n = 0;
/** Buổi giả theo giờ máy: y, m (1–12), d, giờ. */
function ev(y: number, m: number, d: number, h: number, over: Partial<{ title: string; status: 'draft' | 'published' | 'cancelled'; templateId: string | null; slotsTotal: number; slotsFilled: number }> = {}) {
  const s = new Date(y, m - 1, d, h, 0);
  return {
    id: `e${++n}`,
    title: over.title ?? 'Thờ phượng Chúa Nhật',
    startsAt: s.toISOString(),
    endsAt: new Date(s.getTime() + 2 * 3600_000).toISOString(),
    status: over.status ?? 'published',
    templateId: over.templateId ?? null,
    slotsTotal: over.slotsTotal ?? 4,
    slotsFilled: over.slotsFilled ?? 4,
  };
}
const NOW = new Date(2027, 0, 20, 12, 0);

describe('khoảng thời gian', () => {
  it('quý, tháng, tuần (thứ Hai) và nhãn', () => {
    const a = new Date(2027, 1, 17); // T4 17/2/2027
    expect(periodOf('quarter', a)).toEqual({ start: new Date(2027, 0, 1), end: new Date(2027, 3, 1) });
    expect(periodOf('week', a)).toEqual({ start: new Date(2027, 1, 15), end: new Date(2027, 1, 22) });
    expect(periodLabel('quarter', a)).toBe('Q1/2027');
    expect(periodLabel('week', a)).toBe('15/2–21/2');
  });
  it('lùi/tới không trượt tháng từ ngày 31', () => {
    expect(shift('month', new Date(2027, 0, 31), 1)).toEqual(new Date(2027, 1, 1));
    expect(shift('quarter', new Date(2027, 0, 31), -1)).toEqual(new Date(2026, 9, 1));
    expect(shift('week', new Date(2027, 0, 31), 1)).toEqual(new Date(2027, 1, 7));
  });
  it('Q1/2027 chạm 14 tuần (28/12/2026 → 29/3); khoảng tải của năm gồm các tuần chạm 1/1 và 31/12', () => {
    const w = weeksIn(periodOf('quarter', new Date(2027, 0, 1)));
    expect(w).toHaveLength(14);
    expect(w[13]).toEqual(new Date(2027, 2, 29));
    expect(w[0]).toEqual(new Date(2026, 11, 28));
    expect(yearFetchRange(2027)).toEqual({ start: new Date(2026, 11, 28), end: new Date(2028, 0, 3) });
  });
});

describe('trạng thái', () => {
  it('huỷ > đã qua > nháp > thiếu > đủ', () => {
    expect(statusOf(ev(2027, 1, 3, 9), NOW)).toBe('past');
    expect(statusOf(ev(2027, 1, 3, 9, { status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(statusOf(ev(2027, 1, 24, 9, { status: 'draft' }), NOW)).toBe('draft');
    expect(statusOf(ev(2027, 1, 24, 9, { slotsFilled: 3 }), NOW)).toBe('short');
    expect(statusOf(ev(2027, 1, 24, 9, { slotsTotal: 0, slotsFilled: 0 }), NOW)).toBe('ok');
  });
});

describe('nhịp suy ra (IN-53)', () => {
  it('cùng mẫu/tên + thứ + giờ là một nhịp; khác giờ là nhịp khác; buổi một lần vào hàng Buổi lẻ', () => {
    const evs = [
      ev(2027, 1, 3, 9), ev(2027, 1, 10, 9, { title: 'Thờ Phượng  Chúa Nhật' }), ev(2027, 1, 17, 9),
      ev(2027, 1, 6, 19, { title: 'Cầu nguyện' }), ev(2027, 1, 13, 19, { title: 'Cầu nguyện' }),
      ev(2027, 1, 3, 17), // CN chiều: chỉ một lần
      ev(2027, 2, 6, 8, { title: 'Thờ phượng đầu năm' }),
    ];
    const { series, keyOf } = buildSeries(evs);
    expect(series.map((s) => [s.title, s.weekday, s.time, s.count])).toEqual([
      ['Cầu nguyện', 2, '19:00', 2],
      ['Thờ phượng Chúa Nhật', 6, '09:00', 3],
      ['Buổi lẻ', -1, '', 2],
    ]);
    expect(keyOf.get(evs[5]!.id)).toBe(ONE_OFF);
  });
  it('cùng mẫu thì gom dù tên khác', () => {
    const { series } = buildSeries([ev(2027, 1, 3, 9, { templateId: 'T', title: 'A' }), ev(2027, 1, 10, 9, { templateId: 'T', title: 'B' }), ev(2027, 1, 17, 9, { templateId: 'T', title: 'B' })]);
    expect(series).toHaveLength(1);
    expect(series[0]!.title).toBe('B');
  });
  it('chuẩn hoá tên bỏ dấu và khoảng trắng', () => {
    expect(normTitle('  Đón   Khách ')).toBe('don khach');
  });
});

describe('ma trận tuần × nhịp', () => {
  it('đánh dấu tuần trống nằm giữa hai tuần có buổi; buổi đã huỷ không lấp chỗ trống', () => {
    const evs = [ev(2027, 1, 3, 9), ev(2027, 1, 10, 9), ev(2027, 1, 24, 9), ev(2027, 1, 31, 9, { status: 'cancelled' }), ev(2027, 2, 7, 9)];
    const { series, keyOf } = buildSeries(evs);
    const weeks = weeksIn(periodOf('quarter', new Date(2027, 0, 1)));
    const row = matrix(weeks, series, evs, keyOf).get(series[0]!.key)!;
    expect(row.slice(0, 7).map((c) => (c.gap ? 'gap' : c.events.length))).toEqual([1, 1, 'gap', 1, 1, 1, 0]);
  });
});

describe('cây tổng quan', () => {
  it('đếm theo năm/quý/tháng/tuần; cần chú ý = nháp + thiếu', () => {
    const evs = [ev(2027, 1, 3, 9), ev(2027, 1, 24, 9, { slotsFilled: 1 }), ev(2027, 2, 7, 9, { status: 'draft' }), ev(2027, 5, 2, 9, { status: 'draft' }), ev(2026, 12, 27, 9)];
    const t = yearTree(2027, evs, NOW);
    expect(t.stats.total).toBe(4);
    expect(attention(t.quarters[0]!.stats)).toBe(2);
    expect(t.quarters[0]!.months[1]!.stats.draft).toBe(1);
    expect(attention(t.quarters[1]!.stats)).toBe(1);
    const jan = t.quarters[0]!.months[0]!;
    expect(jan.weeks[0]!.start).toEqual(new Date(2026, 11, 28));
    expect(jan.weeks.find((w) => w.start.getTime() === addDays(new Date(2027, 0, 18), 0).getTime())!.stats.short).toBe(1);
  });
});

describe('nhịp đã lưu và buổi dự kiến (P3–P4)', () => {
  const real = {
    id: 'S',
    name: 'Thờ phượng',
    rule: { freq: 'weekly' as const, interval: 1, weekday: 6 },
    localTime: '09:00',
    startsOn: '2027-01-03',
    untilOn: null,
    location: null,
    definition: { durationMin: 120, groupIds: [], positions: [], tasks: [] },
    templateId: null,
    version: 1,
    variants: [],
    canManage: true,
  };
  const occ = (date: string, state: 'projected' | 'skipped' | 'materialized', conflict = false) => ({
    seriesId: 'S',
    date,
    startsAt: new Date(`${date}T09:00:00`).toISOString(),
    endsAt: new Date(`${date}T11:00:00`).toISOString(),
    title: 'Thờ phượng',
    state,
    eventId: null,
    variantId: null,
    conflict: conflict ? { reason: 'special_day' as const, label: 'Tết' } : null,
  });
  it('buổi đã tạo của nhịp vào hàng nhịp thật (đứng đầu); dự kiến/bỏ qua/cần quyết thành ô riêng; đã tạo không lặp lại', () => {
    const made = { ...ev(2027, 1, 3, 9), seriesId: 'S' };
    const items: Ev[] = [made, ev(2027, 1, 6, 19, { title: 'Cầu nguyện' }), ev(2027, 1, 13, 19, { title: 'Cầu nguyện' }), ...occurrenceItems([occ('2027-01-03', 'materialized'), occ('2027-01-10', 'projected'), occ('2027-01-17', 'skipped'), occ('2027-01-24', 'projected', true)])];
    expect(items).toHaveLength(6);
    const { series, keyOf } = buildSeries(items, [real]);
    expect(series.map((s) => s.key)).toEqual(['s:S', expect.stringContaining('cau nguyen')]);
    expect(series[0]!.count).toBe(4);
    expect(keyOf.get(made.id)).toBe('s:S');
    expect(items.slice(3).map((e) => statusOf(e, NOW))).toEqual(['projected', 'skipped', 'conflict']);
    const s = stats(items.filter((e) => e.seriesId === 'S'), NOW);
    expect(s).toMatchObject({ total: 3, projected: 1, skipped: 1, conflict: 1 });
    expect(attention(s)).toBe(1);
  });
});

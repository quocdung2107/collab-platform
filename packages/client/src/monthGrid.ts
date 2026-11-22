/** Lưới tháng cho tab Lịch (UX §4.5): các tuần bắt đầu từ thứ Hai, theo giờ máy. */
export interface Cell {
  date: Date;
  key: string; // yyyy-m-d, khớp dayKey của Calendar
  inMonth: boolean;
}

export const cellKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** month: 0–11. Trả về 5 hoặc 6 hàng × 7 cột phủ hết tháng. */
export function monthCells(year: number, month: number): Cell[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // thứ Hai = 0
  const start = new Date(year, month, 1 - lead);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((lead + daysInMonth) / 7);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7 + c);
      return { date, key: cellKey(date), inMonth: date.getMonth() === month };
    }),
  );
}

/** Khoảng ISO [đầu tháng, đầu tháng sau) để gọi API. */
export const monthRange = (year: number, month: number) => ({ from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 1).toISOString() });

/** So khớp tên không dấu, không phân biệt hoa thường. */
export const fold = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

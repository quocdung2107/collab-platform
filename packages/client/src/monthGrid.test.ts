import { describe, expect, it } from 'vitest';
import { fold, monthCells, monthRange } from './monthGrid';

describe('monthCells', () => {
  it('tháng 11/2026 bắt đầu Chủ nhật: hàng đầu có 6 ô tháng trước, 6 hàng, thứ Hai đầu tuần', () => {
    const rows = monthCells(2026, 10);
    expect(rows).toHaveLength(6);
    expect(rows[0]![0]!.date.getDay()).toBe(1);
    expect(rows[0]!.filter((c) => c.inMonth)).toHaveLength(1);
    expect(rows.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });
  it('số hàng theo tháng: 2/2027 (thứ Hai, 28 ngày) = 4 hàng; 6/2026 = 5 hàng', () => {
    expect(monthCells(2027, 1)).toHaveLength(4);
    expect(monthCells(2026, 5)).toHaveLength(5);
  });
  it('khoảng tháng [đầu, đầu tháng sau)', () => {
    const r = monthRange(2026, 11);
    expect(new Date(r.from).getMonth()).toBe(11);
    expect(new Date(r.to).getFullYear()).toBe(2027);
  });
});

describe('fold', () => {
  it('bỏ dấu và đ', () => expect(fold('Thờ phượng Đón tiếp')).toBe('tho phuong don tiep'));
});

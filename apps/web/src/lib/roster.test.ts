import { describe, expect, it } from 'vitest';
import { columnLabel, distinctNames, excelSerial, matchName, parseHeaderDate, parseRoster, resolveName, splitNames, templateRows } from './roster';
import { readCsv, readXlsx, writeXlsx } from './sheet';

const ref = { year: 2030, month: 1 };

describe('IN-62: đọc tiêu đề ngày', () => {
  it('số ngày Excel (hệ 1900 và 1904), kể cả phần giờ', () => {
    expect(excelSerial(47482)).toEqual({ date: '2029-12-30' });
    expect(parseHeaderDate(47489, ref)).toEqual({ date: '2030-01-06' });
    expect(parseHeaderDate(47489.375, ref)).toEqual({ date: '2030-01-06', time: '09:00' });
    expect(parseHeaderDate(46027, ref, true)).toEqual({ date: '2030-01-06' });
    expect(parseHeaderDate(12, ref)).toBeNull();
  });
  it('chữ: dd/mm/yyyy, dd-mm-yy, dd/mm (năm gần nhất), ISO, kèm thứ và giờ', () => {
    expect(parseHeaderDate('06/01/2030', ref)).toEqual({ date: '2030-01-06' });
    expect(parseHeaderDate('CN 6-1-30', ref)).toEqual({ date: '2030-01-06' });
    expect(parseHeaderDate('Chúa nhật 06/01', ref)).toEqual({ date: '2030-01-06' });
    expect(parseHeaderDate('05/01', { year: 2029, month: 12 })).toEqual({ date: '2030-01-05' });
    expect(parseHeaderDate('2030-01-06 19:30', ref)).toEqual({ date: '2030-01-06', time: '19:30' });
    expect(parseHeaderDate('T4 08/01 19h30', ref)).toEqual({ date: '2030-01-08', time: '19:30' });
    expect(parseHeaderDate('CN 06/01 - 8h', ref)).toEqual({ date: '2030-01-06', time: '08:00' });
    expect(parseHeaderDate('31/02/2030', ref)).toBeNull();
    expect(parseHeaderDate('Ghi chú', ref)).toBeNull();
    expect(columnLabel('2030-01-06')).toBe('CN 06/01/2030');
  });
});

describe('IN-62: tách và khớp tên', () => {
  const people = [
    { userId: 'u1', displayName: 'Nguyễn Quốc Dũng' },
    { userId: 'u2', displayName: 'Trần Thị Lan' },
    { userId: 'u3', displayName: 'Lê Văn An' },
    { userId: 'u4', displayName: 'Phạm An' },
    { userId: 'u5', displayName: 'Mai' },
  ];
  it('tách theo dấu phẩy và các dấu thường gặp, bỏ ghi chú, bỏ trùng', () => {
    expect(splitNames('Dũng, Lan;An\nMai')).toEqual(['Dũng', 'Lan', 'An', 'Mai']);
    expect(splitNames('Dũng và Lan / Mai (dự bị), dung')).toEqual(['Dũng', 'Lan', 'Mai']);
    expect(splitNames('  ')).toEqual([]);
  });
  it('trùng nguyên tên → exact; cuối/đầu tên duy nhất → fuzzy; nhiều người → ambiguous; danh xưng được bỏ', () => {
    expect(matchName('nguyen quoc DUNG', people)).toEqual({ kind: 'exact', userId: 'u1' });
    expect(matchName('Dũng', people)).toEqual({ kind: 'fuzzy', userId: 'u1' });
    expect(matchName('Quốc Dũng', people)).toEqual({ kind: 'fuzzy', userId: 'u1' });
    expect(matchName('An', people)).toEqual({ kind: 'ambiguous', candidates: ['u3', 'u4'] });
    expect(matchName('chị Lan', people)).toEqual({ kind: 'fuzzy', userId: 'u2' });
    expect(matchName('Mai', people)).toEqual({ kind: 'exact', userId: 'u5' });
    expect(matchName('Hùng', people)).toEqual({ kind: 'unknown' });
    expect(resolveName('an', { kind: 'ambiguous', candidates: ['u3', 'u4'] }, { an: 'u4' })).toBe('u4');
    expect(resolveName('dung', { kind: 'fuzzy', userId: 'u1' }, { dung: null })).toBeNull();
    expect(resolveName('dung', { kind: 'fuzzy', userId: 'u1' }, {})).toBe('u1');
  });
});

describe('IN-62: đọc bảng', () => {
  it('dòng đầu là ngày, cột đầu là vị trí; cột không phải ngày bị bỏ và báo; dòng trùng được gộp', () => {
    const grid = readCsv('﻿Vị trí;CN 06/01;CN 13/01;Ghi chú\nÂm thanh;"Dũng, Lan";An;x\nHướng dẫn;;Mai;\n;Hùng;;\nâm thanh;Mai;;\n');
    const r = parseRoster(grid, ref);
    expect(r.columns.map((c) => c.date)).toEqual(['2030-01-06', '2030-01-13']);
    expect(r.rows).toEqual([
      { name: 'Âm thanh', cells: [['Dũng', 'Lan', 'Mai'], ['An']] },
      { name: 'Hướng dẫn', cells: [[], ['Mai']] },
    ]);
    expect(r.issues).toHaveLength(3);
    expect(distinctNames(r).map((n) => [n.key, n.count])).toEqual([
      ['dung', 1],
      ['lan', 1],
      ['mai', 2],
      ['an', 1],
    ]);
  });
  it('bảng đảo chiều (ngày ở cột đầu) được xoay lại', () => {
    const grid = readCsv('Ngày,Âm thanh,Hướng dẫn\n06/01/2030,Dũng,Lan\n13/01/2030,An,\n');
    const r = parseRoster(grid, ref);
    expect(r.columns.map((c) => c.date)).toEqual(['2030-01-06', '2030-01-13']);
    expect(r.rows.map((x) => x.name)).toEqual(['Âm thanh', 'Hướng dẫn']);
    expect(r.rows[1]!.cells).toEqual([['Lan'], []]);
  });
  it('xlsx: file mẫu ghi ra đọc lại được (chuỗi nội tuyến, tiếng Việt, ký tự đặc biệt)', () => {
    const rows = templateRows(['2030-01-06', '2030-01-13'], ['Âm thanh', 'Hướng dẫn & Đón tiếp']);
    rows[1]![1] = 'Dũng, Lan <phụ>';
    const g = readXlsx(writeXlsx(rows));
    expect(g.rows[0]).toEqual(['Vị trí', 'CN 06/01/2030', 'CN 13/01/2030']);
    expect(g.rows[1]).toEqual(['Âm thanh', 'Dũng, Lan <phụ>']);
    expect(g.rows[2]).toEqual(['Hướng dẫn & Đón tiếp']);
    const r = parseRoster(g, ref);
    expect(r.rows[0]!.cells).toEqual([['Dũng', 'Lan <phụ>'], []]);
  });
});

import { describe, expect, it } from 'vitest';
import { addMinutes, fromLocalInput, shortDay, toLocalInput } from './datetime';

describe('datetime', () => {
  it('datetime-local quay vòng theo giờ máy', () => {
    const iso = '2030-01-06T01:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });
  it('cộng phút', () => {
    expect(addMinutes('2030-01-06T01:00:00.000Z', -60)).toBe('2030-01-06T00:00:00.000Z');
  });
});

describe('shortDay', () => {
  it('ngày/tháng hai chữ số', () => expect(shortDay(new Date(2026, 0, 5, 9).toISOString())).toBe('05/01'));
});

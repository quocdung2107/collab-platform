import { describe, expect, it } from 'vitest';
import { eventToIcs } from './ics';

describe('eventToIcs', () => {
  const e = { id: 'abc', title: 'Thờ phượng, sáng', description: 'Dòng 1\nDòng 2; ghi chú', location: null, startsAt: '2026-11-22T02:00:00.000Z', endsAt: '2026-11-22T04:00:00.000Z', status: 'published' };
  it('có giờ UTC, thoát ký tự đặc biệt, xuống dòng CRLF', () => {
    const t = eventToIcs(e, new Date('2026-11-16T00:00:00Z'));
    expect(t).toContain('DTSTART:20261122T020000Z');
    expect(t).toContain('DTEND:20261122T040000Z');
    expect(t).toContain('SUMMARY:Thờ phượng\\, sáng');
    expect(t).toContain('Dòng 1\\nDòng 2\; ghi chú');
    expect(t).not.toContain('LOCATION');
    expect(t.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('buổi huỷ → STATUS:CANCELLED', () => {
    expect(eventToIcs({ ...e, status: 'cancelled' })).toContain('STATUS:CANCELLED');
  });
});

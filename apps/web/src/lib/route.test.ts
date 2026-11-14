import { describe, expect, it } from 'vitest';
import { href, parseRoute } from './route';

describe('parseRoute', () => {
  it('đọc các tuyến hash và quay vòng với href', () => {
    for (const r of [
      { name: 'home' },
      { name: 'org', id: '01a1d7cf-0000-7000-8000-000000000000' },
      { name: 'group', id: '01a1d7cf-0000-7000-8000-000000000001' },
      { name: 'invite', token: 'Ab_-'.repeat(10) + 'xyz' },
      { name: 'od17' },
    ] as const) {
      expect(parseRoute(href(r))).toEqual(r);
    }
  });
  it('hash lạ → home', () => {
    expect(parseRoute('#org=')).toEqual({ name: 'home' });
    expect(parseRoute('#foo=bar')).toEqual({ name: 'home' });
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});

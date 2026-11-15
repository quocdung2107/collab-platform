import { describe, expect, it } from 'vitest';
import { HashTrail, href, isTabRoot, parentOf, parseRoute, tabOf } from './route';

describe('parseRoute', () => {
  it('đọc các tuyến hash và quay vòng với href', () => {
    for (const r of [
      { name: 'home' },
      { name: 'org', id: '01a1d7cf-0000-7000-8000-000000000000' },
      { name: 'group', id: '01a1d7cf-0000-7000-8000-000000000001' },
      { name: 'invite', token: 'Ab_-'.repeat(10) + 'xyz' },
      { name: 'inbox' },
      { name: 'settings' },
      { name: 'event', id: '01a1d7cf-0000-7000-8000-000000000002' },
      { name: 'chat', id: '01a1d7cf-0000-7000-8000-000000000003' },
      { name: 'newevent', id: '01a1d7cf-0000-7000-8000-000000000000' },
      { name: 'newevent', id: '01a1d7cf-0000-7000-8000-000000000000', copy: '01a1d7cf-0000-7000-8000-000000000002' },
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

describe('tuyến của 4 tab', () => {
  it('quay vòng các tuyến không tham số', () => {
    for (const name of ['calendar', 'plan', 'chats', 'groups', 'me'] as const) expect(parseRoute(href({ name }))).toEqual({ name });
  });
  it('mỗi màn hình chi tiết sáng đúng tab và có nơi quay về', () => {
    expect(tabOf({ name: 'event', id: 'x' })).toBe('calendar');
    expect(tabOf({ name: 'group', id: 'x' })).toBe('groups');
    expect(tabOf({ name: 'task', id: 'x' })).toBe('work');
    expect(tabOf({ name: 'inbox' })).toBeNull();
    expect(tabOf({ name: 'plan' })).toBe('calendar');
    expect(parentOf({ name: 'plan' })).toEqual({ name: 'calendar' });
    expect(isTabRoot({ name: 'plan' })).toBe(false);
    expect(parentOf({ name: 'event', id: 'x' })).toEqual({ name: 'calendar' });
    expect(parentOf({ name: 'settings' })).toEqual({ name: 'me' });
    expect(isTabRoot({ name: 'chats' })).toBe(true);
    expect(isTabRoot({ name: 'event', id: 'x' })).toBe(false);
  });
});

describe('HashTrail', () => {
  it('đi tới rồi lùi bằng cử chỉ hệ điều hành', () => {
    const t = new HashTrail('#');
    expect(t.canGoBack()).toBe(false);
    expect(t.visit('#calendar')).toBe('forward');
    t.visit('#event=1');
    expect(t.canGoBack()).toBe(true);
    expect(t.visit('#calendar')).toBe('back');
    expect(t.visit('#')).toBe('back');
    expect(t.canGoBack()).toBe(false);
  });
  it('location.replace không thêm bước', () => {
    const t = new HashTrail('#event=1');
    t.willReplace();
    t.visit('#calendar');
    expect(t.canGoBack()).toBe(false);
  });
});

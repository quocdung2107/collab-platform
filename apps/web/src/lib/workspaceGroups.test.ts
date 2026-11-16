import { describe, expect, it } from 'vitest';
import { groupShort } from './workspaceGroups';

const p = (over: Record<string, unknown>) => ({
  eventId: 'e1', eventTitle: 'Thờ phượng', eventStatus: 'published', startsAt: '2026-11-22T08:00:00Z', orgName: 'HT',
  positionId: 'p', positionName: 'Âm thanh', groupName: null, slots: 2, filled: 0, ...over,
}) as never;

describe('groupShort', () => {
  it('gộp theo buổi, cộng số chỗ thiếu, giữ cờ bản nháp', () => {
    const g = groupShort([p({ positionId: 'a' }), p({ positionId: 'b', positionName: 'Hát', filled: 1 }), p({ eventId: 'e2', eventStatus: 'draft' })]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ eventId: 'e1', total: 3, draft: false, positions: [{ name: 'Âm thanh', missing: 2 }, { name: 'Hát', missing: 1 }] });
    expect(g[1]).toMatchObject({ eventId: 'e2', draft: true });
  });
});

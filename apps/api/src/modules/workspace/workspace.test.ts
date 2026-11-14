import { describe, expect, it } from 'vitest';
import { sortUpcoming } from './workspace.js';

const task = (id: string, dueAt: string | null, overdue = false) =>
  ({ kind: 'task', id, orgId: 'o', orgName: 'O', title: id, status: 'open', acceptance: 'none', dueAt, overdue, scope: { type: 'private', id: null, name: null } }) as const;
const asg = (id: string, reportAt: string) =>
  ({ kind: 'assignment', id, status: 'accepted', orgId: 'o', orgName: 'O', eventId: 'e', eventTitle: 'E', startsAt: reportAt, location: null, positionName: 'P', groupName: null, reportAt }) as const;

describe('F12-T3: thứ tự Sắp tới', () => {
  it('quá hạn lên đầu; trộn giờ có mặt và hạn; không hạn cuối', () => {
    const r = sortUpcoming([
      task('none', null),
      asg('a2', '2030-01-03T00:00:00Z'),
      task('t1', '2030-01-02T00:00:00Z'),
      task('late', '2029-12-01T00:00:00Z', true),
      asg('a1', '2030-01-01T00:00:00Z'),
    ]);
    expect(r.map((x) => x.id)).toEqual(['late', 'a1', 't1', 'a2', 'none']);
  });
});

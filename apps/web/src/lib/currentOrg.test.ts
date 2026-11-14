import { describe, expect, it } from 'vitest';
import { pickOrg } from './currentOrg';

const a = { orgId: 'a', orgName: 'A', role: 'member' as const };
const b = { orgId: 'b', orgName: 'B', role: 'admin' as const };

describe('pickOrg', () => {
  it('giữ tổ chức đã chọn nếu còn là thành viên', () => expect(pickOrg([a, b], 'b')).toBe(b));
  it('rơi về tổ chức đầu tiên khi đã rời tổ chức đã chọn', () => expect(pickOrg([a, b], 'zzz')).toBe(a));
  it('không thuộc tổ chức nào → null', () => expect(pickOrg([], 'a')).toBeNull());
});

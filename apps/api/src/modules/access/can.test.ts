import type { GroupRole, OrgRole } from '@collab/shared';
import { describe, expect, it } from 'vitest';
import { can, type ActorContext, type GroupAction, type GroupObject, type OrgAction, type OrgObject } from './can.js';

const ORG = 'org-1';
const GROUP = 'grp-1';

function actor(orgRole: OrgRole | null, groupRole?: GroupRole, orgId = ORG): ActorContext {
  return { userId: 'u', orgId, orgRole, groupRoles: new Map(groupRole ? [[GROUP, groupRole]] : []) };
}
const org = (extra: Partial<OrgObject> = {}): OrgObject => ({ type: 'organization', id: ORG, ...extra });
const group = (extra: Partial<GroupObject> = {}): GroupObject => ({ type: 'group', id: GROUP, orgId: ORG, archived: false, ...extra });

type Expect = 'Y' | 'F' | 'N'; // Y = được, F = forbidden, N = not_found
const outcome = (d: ReturnType<typeof can>): Expect => (d.allowed ? 'Y' : d.deny === 'forbidden' ? 'F' : 'N');

describe('PERMISSION_MODEL §4.1 Organization', () => {
  // [hành động, owner, admin, member]
  const matrix: Array<[OrgAction, Expect, Expect, Expect]> = [
    ['org.view', 'Y', 'Y', 'Y'],
    ['org.update', 'Y', 'Y', 'F'],
    ['org.invites.manage', 'Y', 'Y', 'F'],
    ['org.members.remove', 'Y', 'Y', 'F'],
    ['org.members.set_admin', 'Y', 'Y', 'F'],
    ['org.owners.manage', 'Y', 'F', 'F'],
    ['org.delete', 'Y', 'F', 'F'],
    ['org.templates.manage', 'Y', 'Y', 'F'],
    ['group.create', 'Y', 'Y', 'F'],
  ];
  it.each(matrix)('%s', (action, owner, admin, member) => {
    expect(outcome(can(actor('owner'), action, org()))).toBe(owner);
    expect(outcome(can(actor('admin'), action, org()))).toBe(admin);
    expect(outcome(can(actor('member'), action, org()))).toBe(member);
  });

  it('owner rời tổ chức chỉ khi còn owner khác', () => {
    expect(outcome(can(actor('owner'), 'org.leave', org({ activeOwnerCount: 1 })))).toBe('F');
    expect(outcome(can(actor('owner'), 'org.leave', org({ activeOwnerCount: 2 })))).toBe('Y');
    expect(outcome(can(actor('admin'), 'org.leave', org()))).toBe('Y');
    expect(outcome(can(actor('member'), 'org.leave', org()))).toBe('Y');
  });

  it('không phải thành viên active → not_found cho mọi hành động (AD-12)', () => {
    for (const [action] of matrix) expect(outcome(can(actor(null), action, org()))).toBe('N');
  });

  it('vai trò ở tổ chức khác không mang sang (ranh giới tenant)', () => {
    expect(outcome(can(actor('owner', undefined, 'org-2'), 'org.view', org()))).toBe('N');
  });
});

describe('PERMISSION_MODEL §4.2 Group', () => {
  // [hành động, org admin không thuộc nhóm, leader, member, thành viên tổ chức không thuộc nhóm]
  const matrix: Array<[GroupAction, Expect, Expect, Expect, Expect]> = [
    ['group.view', 'Y', 'Y', 'Y', 'Y'],
    ['group.update', 'Y', 'Y', 'F', 'F'],
    ['group.archive', 'Y', 'Y', 'F', 'F'],
    ['group.members.manage', 'Y', 'Y', 'F', 'F'],
  ];
  it.each(matrix)('%s', (action, admin, leader, member, outsider) => {
    expect(outcome(can(actor('admin'), action, group()))).toBe(admin);
    expect(outcome(can(actor('member', 'leader'), action, group()))).toBe(leader);
    expect(outcome(can(actor('member', 'member'), action, group()))).toBe(member);
    expect(outcome(can(actor('member'), action, group()))).toBe(outsider);
  });

  it('AD-11: org admin không đọc hội thoại nhóm nếu không là thành viên', () => {
    expect(outcome(can(actor('owner'), 'group.conversation.read', group()))).toBe('F');
    expect(outcome(can(actor('owner', 'member'), 'group.conversation.read', group()))).toBe('Y');
    expect(outcome(can(actor('member', 'member'), 'group.conversation.read', group()))).toBe('Y');
  });

  it('leader rời nhóm chỉ khi còn leader khác; member rời tự do', () => {
    expect(outcome(can(actor('member', 'leader'), 'group.leave', group({ leaderCount: 1 })))).toBe('F');
    expect(outcome(can(actor('member', 'leader'), 'group.leave', group({ leaderCount: 2 })))).toBe('Y');
    expect(outcome(can(actor('member', 'member'), 'group.leave', group()))).toBe('Y');
    expect(outcome(can(actor('member'), 'group.leave', group()))).toBe('F');
  });

  it('nhóm đã lưu trữ: không quản lý thành viên được nữa', () => {
    expect(outcome(can(actor('admin'), 'group.members.manage', group({ archived: true })))).toBe('F');
  });

  it('nhóm của tổ chức khác → not_found', () => {
    expect(outcome(can(actor('owner'), 'group.view', group({ orgId: 'org-2' })))).toBe('N');
  });
});

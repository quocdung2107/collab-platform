import type { GroupRole, OrgRole } from '@collab/shared';
import { describe, expect, it } from 'vitest';
import { can, type ActorContext, type AssignmentObject, type ConversationObject, type EventObject, type PositionObject, type GroupAction, type GroupObject, type MessageObject, type OrgAction, type OrgObject } from './can.js';

const ORG = 'org-1';
const GROUP = 'grp-1';

function actor(orgRole: OrgRole | null, groupRole?: GroupRole, orgId = ORG): ActorContext {
  return { userId: 'u', orgId, orgRole, groupRoles: new Map(groupRole ? [[GROUP, groupRole]] : []) };
}
const org = (extra: Partial<OrgObject> = {}): OrgObject => ({ type: 'organization', id: ORG, ...extra });
const group = (extra: Partial<GroupObject> = {}): GroupObject => ({ type: 'group', id: GROUP, orgId: ORG, archived: false, ...extra });

type Expect = 'Y' | 'F' | 'N' | 'R'; // Y = được, F = forbidden, N = not_found, R = read_only
const outcome = (d: ReturnType<typeof can>): Expect => (d.allowed ? 'Y' : d.deny === 'forbidden' ? 'F' : d.deny === 'read_only' ? 'R' : 'N');

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

describe('PERMISSION_MODEL §4.3 Conversation / Message (anchor group)', () => {
  const conv = (readOnly = false): ConversationObject => ({ type: 'conversation', id: 'c-1', orgId: ORG, anchor: { type: 'group', id: GROUP }, readOnly });
  const msg = (senderId: string | null, extra: Partial<MessageObject> = {}): MessageObject => ({
    type: 'message', id: 'm-1', orgId: ORG, conversation: conv(), kind: 'user', senderId, deleted: false, ...extra,
  });
  const me = (orgRole: OrgRole, groupRole?: GroupRole) => ({ ...actor(orgRole, groupRole), userId: 'me' });

  it('đọc/gửi: chỉ thành viên nhóm; org admin ngoài nhóm → not_found (AD-11)', () => {
    expect(outcome(can(me('member', 'member'), 'conversation.read', conv()))).toBe('Y');
    expect(outcome(can(me('member', 'member'), 'conversation.post', conv()))).toBe('Y');
    expect(outcome(can(me('owner'), 'conversation.read', conv()))).toBe('N');
    expect(outcome(can(me('member'), 'conversation.post', conv()))).toBe('N');
    expect(outcome(can(actor(null, 'member'), 'conversation.read', conv()))).toBe('N');
  });
  it('hội thoại chỉ-đọc: đọc được, gửi → read_only', () => {
    expect(outcome(can(me('member', 'member'), 'conversation.read', conv(true)))).toBe('Y');
    expect(outcome(can(me('member', 'member'), 'conversation.post', conv(true)))).toBe('R');
  });
  it('sửa: chỉ người gửi; xoá: người gửi, leader, org admin đọc được hội thoại', () => {
    expect(outcome(can(me('member', 'member'), 'message.edit', msg('me')))).toBe('Y');
    expect(outcome(can(me('admin', 'leader'), 'message.edit', msg('other')))).toBe('F');
    expect(outcome(can(me('member', 'member'), 'message.delete', msg('other')))).toBe('F');
    expect(outcome(can(me('member', 'leader'), 'message.delete', msg('other')))).toBe('Y');
    expect(outcome(can(me('admin', 'member'), 'message.delete', msg('other')))).toBe('Y');
    expect(outcome(can(me('admin'), 'message.delete', msg('other')))).toBe('N');
  });
  it('tin system không sửa/xoá được; tin đã xoá không sửa được', () => {
    expect(outcome(can(me('owner', 'leader'), 'message.delete', msg(null, { kind: 'system' })))).toBe('F');
    expect(outcome(can(me('member', 'member'), 'message.edit', msg('me', { deleted: true })))).toBe('F');
  });
});

describe('PERMISSION_MODEL §3, §4.4, §4.5 Event, Position, Assignment', () => {
  const OTHER = 'grp-2';
  const ev = (extra: Partial<EventObject> = {}): EventObject => ({
    type: 'event', id: 'e-1', orgId: ORG, status: 'published', visibility: 'org', groupIds: [GROUP], ownerIds: [], activeAssigneeIds: [], ...extra,
  });
  const pos = (groupId: string | null, e = ev()): PositionObject => ({ type: 'position', id: 'p-1', orgId: ORG, event: e, groupId });
  const asg = (userId: string, status: AssignmentObject['status'], p = pos(GROUP)): AssignmentObject => ({ type: 'assignment', id: 'a-1', orgId: ORG, position: p, userId, status });
  const owner: ActorContext = { ...actor('member'), userId: 'ow' };

  it('view: bản nháp chỉ admin, owner, leader nhóm trong event_groups', () => {
    const d = ev({ status: 'draft', ownerIds: ['ow'] });
    expect(outcome(can(actor('admin'), 'event.view', d))).toBe('Y');
    expect(outcome(can(owner, 'event.view', d))).toBe('Y');
    expect(outcome(can(actor('member', 'leader'), 'event.view', d))).toBe('Y');
    expect(outcome(can(actor('member', 'member'), 'event.view', d))).toBe('N');
  });
  it('view: visibility groups → thành viên nhóm hoặc người được xếp (đang hiệu lực)', () => {
    const g = ev({ visibility: 'groups' });
    expect(outcome(can(actor('member', 'member'), 'event.view', g))).toBe('Y');
    expect(outcome(can(actor('member'), 'event.view', g))).toBe('N');
    expect(outcome(can(actor('member'), 'event.view', ev({ visibility: 'groups', activeAssigneeIds: ['u'] })))).toBe('Y');
    expect(outcome(can(actor('member'), 'event.view', ev()))).toBe('Y');
    expect(outcome(can(actor('admin', undefined, 'org-2'), 'event.view', ev()))).toBe('N');
  });
  it('edit: admin hoặc event_owner; leader thì không', () => {
    expect(outcome(can(owner, 'event.edit', ev({ ownerIds: ['ow'] })))).toBe('Y');
    expect(outcome(can(actor('admin'), 'event.edit', ev()))).toBe('Y');
    expect(outcome(can(actor('member', 'leader'), 'event.edit', ev()))).toBe('F');
  });
  it('tạo: admin hoặc leader của một nhóm trong Event', () => {
    expect(outcome(can(actor('member', 'leader'), 'event.create', { type: 'event_draft', orgId: ORG, groupIds: [GROUP] }))).toBe('Y');
    expect(outcome(can(actor('member', 'leader'), 'event.create', { type: 'event_draft', orgId: ORG, groupIds: [OTHER] }))).toBe('F');
    expect(outcome(can(actor('member', 'member'), 'event.create', { type: 'event_draft', orgId: ORG, groupIds: [GROUP] }))).toBe('F');
    expect(outcome(can(actor('admin'), 'event.create', { type: 'event_draft', orgId: ORG, groupIds: [] }))).toBe('Y');
  });
  it('position.manage: owner, admin, leader đúng nhóm của Position; Event huỷ → forbidden', () => {
    expect(outcome(can(actor('member', 'leader'), 'position.manage', pos(GROUP)))).toBe('Y');
    expect(outcome(can(actor('member', 'leader'), 'position.manage', pos(OTHER, ev({ groupIds: [GROUP, OTHER] }))))).toBe('F');
    expect(outcome(can(actor('member', 'leader'), 'position.manage', pos(null)))).toBe('F');
    expect(outcome(can(owner, 'position.manage', pos(null, ev({ ownerIds: ['ow'] }))))).toBe('Y');
    expect(outcome(can(actor('member', 'member'), 'position.manage', pos(GROUP)))).toBe('F');
    expect(outcome(can(actor('admin'), 'position.manage', pos(GROUP, ev({ status: 'cancelled' }))))).toBe('F');
  });
  it('Assignment draft ẩn với người không quản lý; lý do từ chối chỉ người quản lý và chính người được xếp', () => {
    expect(outcome(can(actor('member', 'member'), 'assignment.view', asg('x', 'draft')))).toBe('N');
    expect(outcome(can(actor('member', 'member'), 'assignment.view', asg('x', 'requested')))).toBe('Y');
    expect(outcome(can(actor('member', 'member'), 'assignment.view_decline_reason', asg('x', 'declined')))).toBe('F');
    expect(outcome(can(actor('member', 'member'), 'assignment.view_decline_reason', asg('u', 'declined')))).toBe('Y');
    expect(outcome(can(actor('member', 'leader'), 'assignment.view_decline_reason', asg('x', 'declined')))).toBe('Y');
  });
});

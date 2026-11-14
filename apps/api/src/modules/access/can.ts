import type { GroupRole, OrgRole } from '@collab/shared';

/**
 * Module Access — điểm quyết định duy nhất (PERMISSION_MODEL §1.2, AD-28).
 *
 * can() là hàm thuần: nhận ngữ cảnh người dùng đã nạp sẵn (ActorContext) và mô tả đối tượng,
 * trả về quyết định. Không truy vấn DB ở đây để dễ kiểm thử theo ma trận; việc nạp ngữ cảnh
 * nằm ở context.ts.
 *
 * Phạm vi hiện tại: Organization (§4.1) và Group (§4.2). Event, Assignment, Task, Conversation...
 * được thêm theo từng lát cắt.
 */

/** Ngữ cảnh của người dùng trong MỘT tổ chức. orgRole = null nghĩa là không có Membership active. */
export interface ActorContext {
  userId: string;
  orgId: string;
  orgRole: OrgRole | null;
  /** group_id → vai trò trong nhóm (chỉ các nhóm của tổ chức này). */
  groupRoles: ReadonlyMap<string, GroupRole>;
}

export type OrgObject = {
  type: 'organization';
  id: string;
  /** Số owner active hiện có; cần cho hành động "leave". */
  activeOwnerCount?: number;
};

export type GroupObject = {
  type: 'group';
  id: string;
  orgId: string;
  archived: boolean;
  /** Số leader hiện có; cần cho hành động "leave". */
  leaderCount?: number;
};

export type OrgAction =
  | 'org.view'
  | 'org.update'
  | 'org.invites.manage'
  | 'org.members.remove'
  | 'org.members.set_admin'
  | 'org.owners.manage'
  | 'org.delete'
  | 'org.templates.manage'
  | 'org.leave'
  | 'group.create';

export type GroupAction =
  | 'group.view'
  | 'group.update'
  | 'group.archive'
  | 'group.members.manage'
  | 'group.leave'
  | 'group.conversation.read';

export type Decision =
  | { allowed: true }
  /** not_found: không được xem đối tượng → không lộ sự tồn tại (AD-12). forbidden: xem được nhưng không được làm. */
  | { allowed: false; deny: 'not_found' | 'forbidden'; reason: string };

const ALLOW: Decision = { allowed: true };
const hidden = (reason: string): Decision => ({ allowed: false, deny: 'not_found', reason });
const forbidden = (reason: string): Decision => ({ allowed: false, deny: 'forbidden', reason });

export const isOrgAdmin = (a: ActorContext) => a.orgRole === 'owner' || a.orgRole === 'admin';

export function can(actor: ActorContext, action: OrgAction, object: OrgObject): Decision;
export function can(actor: ActorContext, action: GroupAction, object: GroupObject): Decision;
export function can(actor: ActorContext, action: OrgAction | GroupAction, object: OrgObject | GroupObject): Decision {
  const orgId = object.type === 'organization' ? object.id : object.orgId;
  // Mọi vai trò đòi hỏi Membership active trong đúng tổ chức của đối tượng (PERMISSION_MODEL §2).
  if (actor.orgId !== orgId || actor.orgRole === null) return hidden('not an active member of the organization');

  if (object.type === 'organization') return canOrg(actor, action as OrgAction, object);
  return canGroup(actor, action as GroupAction, object);
}

function canOrg(actor: ActorContext, action: OrgAction, org: OrgObject): Decision {
  const role = actor.orgRole!;
  switch (action) {
    case 'org.view':
      return ALLOW;
    case 'org.update':
    case 'org.invites.manage':
    case 'org.members.remove':
    case 'org.members.set_admin':
    case 'org.templates.manage':
    case 'group.create': // OD-05 mặc định: chỉ org admin tạo nhóm
      return isOrgAdmin(actor) ? ALLOW : forbidden('requires org admin');
    case 'org.owners.manage':
    case 'org.delete':
      return role === 'owner' ? ALLOW : forbidden('requires owner');
    case 'org.leave':
      if (role !== 'owner') return ALLOW;
      if (org.activeOwnerCount === undefined) throw new Error('can(org.leave) cần activeOwnerCount');
      return org.activeOwnerCount > 1 ? ALLOW : forbidden('last owner cannot leave');
  }
}

function canGroup(actor: ActorContext, action: GroupAction, group: GroupObject): Decision {
  const groupRole = actor.groupRoles.get(group.id) ?? null;
  const admin = isOrgAdmin(actor);
  const leader = groupRole === 'leader';

  switch (action) {
    case 'group.view':
      return ALLOW; // view(group) = view(organization)
    case 'group.conversation.read':
      // AD-11: org admin không đọc hội thoại nhóm nếu không là thành viên.
      return groupRole !== null ? ALLOW : forbidden('not a group member');
    case 'group.update':
    case 'group.archive':
    case 'group.members.manage':
      if (group.archived && action !== 'group.update') return forbidden('group archived');
      return admin || leader ? ALLOW : forbidden('requires org admin or group leader');
    case 'group.leave':
      if (groupRole === null) return forbidden('not a group member');
      if (!leader) return ALLOW;
      if (group.leaderCount === undefined) throw new Error('can(group.leave) cần leaderCount');
      return group.leaderCount > 1 ? ALLOW : forbidden('last leader cannot leave');
  }
}

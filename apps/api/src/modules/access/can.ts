import type { GroupRole, OrgRole } from '@collab/shared';

/**
 * Module Access — điểm quyết định duy nhất (PERMISSION_MODEL §1.2, AD-28).
 *
 * can() là hàm thuần: nhận ngữ cảnh người dùng đã nạp sẵn (ActorContext) và mô tả đối tượng,
 * trả về quyết định. Không truy vấn DB ở đây để dễ kiểm thử theo ma trận; việc nạp ngữ cảnh
 * nằm ở context.ts.
 *
 * Phạm vi hiện tại: Organization (§4.1), Group (§4.2), Conversation/Message (§4.3, anchor group/event),
 * Event/Position/Assignment (§3, §4.4, §4.5). Task được thêm ở lát S10.
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

/** Event (§3 view(event), §4.4). Danh sách nhỏ nên mang theo để can() là hàm thuần. */
export type EventObject = {
  type: 'event';
  id: string;
  orgId: string;
  status: 'draft' | 'published' | 'cancelled';
  visibility: 'org' | 'groups';
  groupIds: readonly string[];
  ownerIds: readonly string[];
  /** Người có Assignment đang hiệu lực (requested/accepted/reconfirm) — xem được Event visibility = groups. */
  activeAssigneeIds: readonly string[];
};

/** Tạo Event: chưa có id; cần nhóm dự kiến để kiểm tra leader (§4.4). */
export type EventDraftObject = { type: 'event_draft'; orgId: string; groupIds: readonly string[] };

export type PositionObject = { type: 'position'; id: string | null; orgId: string; event: EventObject; groupId: string | null };

export type AssignmentObject = {
  type: 'assignment';
  id: string;
  orgId: string;
  position: PositionObject;
  userId: string;
  status: 'draft' | 'requested' | 'accepted' | 'declined' | 'reconfirm' | 'cancelled';
};

/** Hội thoại (§4.3): anchor group (S4) hoặc event (S5); task thêm ở S10. */
export type ConversationObject = {
  type: 'conversation';
  id: string;
  orgId: string;
  anchor: { type: 'group'; id: string } | { type: 'event'; id: string; event: EventObject };
  readOnly: boolean;
};

export type MessageObject = {
  type: 'message';
  id: string;
  orgId: string;
  conversation: ConversationObject;
  kind: 'user' | 'system';
  senderId: string | null;
  deleted: boolean;
};

export type ConversationAction = 'conversation.read' | 'conversation.post';
export type MessageAction = 'message.edit' | 'message.delete';

export type EventAction = 'event.view' | 'event.edit';
export type EventDraftAction = 'event.create';
export type PositionAction = 'position.manage';
export type AssignmentAction = 'assignment.view' | 'assignment.view_decline_reason' | 'assignment.respond' | 'assignment.manage';

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
  /**
   * not_found: không được xem đối tượng → không lộ sự tồn tại (AD-12). forbidden: xem được nhưng không được làm.
   * read_only: được xem nhưng đối tượng đã khoá ghi (hội thoại của nhóm lưu trữ / Event huỷ).
   */
  | { allowed: false; deny: 'not_found' | 'forbidden' | 'read_only'; reason: string };

const ALLOW: Decision = { allowed: true };
const hidden = (reason: string): Decision => ({ allowed: false, deny: 'not_found', reason });
const forbidden = (reason: string): Decision => ({ allowed: false, deny: 'forbidden', reason });
const readOnly = (reason: string): Decision => ({ allowed: false, deny: 'read_only', reason });

export const isOrgAdmin = (a: ActorContext) => a.orgRole === 'owner' || a.orgRole === 'admin';

export function can(actor: ActorContext, action: OrgAction, object: OrgObject): Decision;
export function can(actor: ActorContext, action: GroupAction, object: GroupObject): Decision;
export function can(actor: ActorContext, action: ConversationAction, object: ConversationObject): Decision;
export function can(actor: ActorContext, action: MessageAction, object: MessageObject): Decision;
export function can(actor: ActorContext, action: EventAction, object: EventObject): Decision;
export function can(actor: ActorContext, action: EventDraftAction, object: EventDraftObject): Decision;
export function can(actor: ActorContext, action: PositionAction, object: PositionObject): Decision;
export function can(actor: ActorContext, action: AssignmentAction, object: AssignmentObject): Decision;
export function can(
  actor: ActorContext,
  action: OrgAction | GroupAction | ConversationAction | MessageAction | EventAction | EventDraftAction | PositionAction | AssignmentAction,
  object: OrgObject | GroupObject | ConversationObject | MessageObject | EventObject | EventDraftObject | PositionObject | AssignmentObject,
): Decision {
  const orgId = object.type === 'organization' ? object.id : object.orgId;
  // Mọi vai trò đòi hỏi Membership active trong đúng tổ chức của đối tượng (PERMISSION_MODEL §2).
  if (actor.orgId !== orgId || actor.orgRole === null) return hidden('not an active member of the organization');

  if (object.type === 'organization') return canOrg(actor, action as OrgAction, object);
  if (object.type === 'group') return canGroup(actor, action as GroupAction, object);
  if (object.type === 'conversation') return canConversation(actor, action as ConversationAction, object);
  if (object.type === 'message') return canMessage(actor, action as MessageAction, object);
  if (object.type === 'event') return canEvent(actor, action as EventAction, object);
  if (object.type === 'event_draft') return canCreateEvent(actor, object);
  if (object.type === 'position') return canPosition(actor, object);
  return canAssignment(actor, action as AssignmentAction, object);
}

const isEventOwner = (a: ActorContext, e: EventObject) => e.ownerIds.includes(a.userId);
const leadsAnyOf = (a: ActorContext, groupIds: readonly string[]) => groupIds.some((g) => a.groupRoles.get(g) === 'leader');

/** view(event) — PERMISSION_MODEL §3. */
export function viewsEvent(a: ActorContext, e: EventObject): boolean {
  if (isOrgAdmin(a) || isEventOwner(a, e)) return true;
  if (e.status === 'draft') return leadsAnyOf(a, e.groupIds);
  if (e.visibility === 'org') return true;
  return e.groupIds.some((g) => a.groupRoles.has(g)) || e.activeAssigneeIds.includes(a.userId);
}

function canEvent(actor: ActorContext, action: EventAction, e: EventObject): Decision {
  if (!viewsEvent(actor, e)) return hidden('cannot view event');
  switch (action) {
    case 'event.view':
      return ALLOW;
    case 'event.edit':
      // Sửa, publish, dời lịch, huỷ, owner, event_groups, visibility, xoá nháp (§4.4).
      return isOrgAdmin(actor) || isEventOwner(actor, e) ? ALLOW : forbidden('requires org admin or event owner');
  }
}

function canCreateEvent(actor: ActorContext, d: EventDraftObject): Decision {
  if (isOrgAdmin(actor) || leadsAnyOf(actor, d.groupIds)) return ALLOW;
  return forbidden('requires org admin or leader of an event group');
}

/** position_manager = event_owner ∪ org admin ∪ leader của positions.group_id (§2). */
export function managesPosition(a: ActorContext, p: PositionObject): boolean {
  return isOrgAdmin(a) || isEventOwner(a, p.event) || (p.groupId !== null && a.groupRoles.get(p.groupId) === 'leader');
}

function canPosition(actor: ActorContext, p: PositionObject): Decision {
  if (!viewsEvent(actor, p.event)) return hidden('cannot view event');
  if (p.event.status === 'cancelled') return forbidden('event cancelled');
  return managesPosition(actor, p) ? ALLOW : forbidden('requires position manager');
}

function canAssignment(actor: ActorContext, action: AssignmentAction, a: AssignmentObject): Decision {
  if (!viewsEvent(actor, a.position.event)) return hidden('cannot view event');
  const manager = managesPosition(actor, a.position);
  switch (action) {
    case 'assignment.view':
      // Assignment draft chỉ position_manager thấy (§3).
      return a.status !== 'draft' || manager ? ALLOW : hidden('draft assignment');
    case 'assignment.view_decline_reason':
      return manager || a.userId === actor.userId ? ALLOW : forbidden('restricted field');
    case 'assignment.respond':
      // Người được xếp trả lời cho mình; position_manager trả lời hộ (ghi responded_by, T11).
      if (a.status === 'draft' && !manager) return hidden('draft assignment');
      return manager || a.userId === actor.userId ? ALLOW : forbidden('requires assignee or position manager');
    case 'assignment.manage':
      if (a.status === 'draft' && !manager) return hidden('draft assignment');
      if (a.position.event.status === 'cancelled') return forbidden('event cancelled');
      return manager ? ALLOW : forbidden('requires position manager');
  }
}

/** read(conversation): anchor group → thành viên nhóm (AD-11); anchor event → view(event). */
function readsConversation(actor: ActorContext, c: ConversationObject): boolean {
  if (c.anchor.type === 'group') return actor.groupRoles.has(c.anchor.id);
  return viewsEvent(actor, c.anchor.event);
}

function canConversation(actor: ActorContext, action: ConversationAction, c: ConversationObject): Decision {
  if (!readsConversation(actor, c)) return hidden('cannot read conversation');
  switch (action) {
    case 'conversation.read':
      return ALLOW;
    case 'conversation.post':
      return c.readOnly ? readOnly('conversation is read-only') : ALLOW;
  }
}

function canMessage(actor: ActorContext, action: MessageAction, m: MessageObject): Decision {
  const c = m.conversation;
  if (!readsConversation(actor, c)) return hidden('cannot read conversation');
  if (m.kind === 'system') return forbidden('system messages are immutable');
  if (m.deleted) return forbidden('message deleted');
  const own = m.senderId === actor.userId;
  switch (action) {
    case 'message.edit':
      if (!own) return forbidden('only the sender edits');
      return c.readOnly ? readOnly('conversation is read-only') : ALLOW;
    case 'message.delete':
      // Người gửi; leader (hội thoại nhóm) / event_owner (thread Event); org admin nếu đọc được hội thoại (§4.3).
      if (own || isOrgAdmin(actor)) return ALLOW;
      if (c.anchor.type === 'group' && actor.groupRoles.get(c.anchor.id) === 'leader') return ALLOW;
      if (c.anchor.type === 'event' && isEventOwner(actor, c.anchor.event)) return ALLOW;
      return forbidden('requires sender, group leader, event owner or org admin');
  }
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

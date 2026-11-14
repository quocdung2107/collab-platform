import type { GroupDetailDto, GroupMemberDto, GroupRole, GroupSummaryDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { normalizeText } from '../../lib/text.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type GroupObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { emit, signalAccessChanged } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { topics } from '../realtime/publisher.js';

interface GroupRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  archived_at: Date | null;
  version: number;
}

const COLS = 'id, org_id, name, description, archived_at, version';

async function loadGroup(db: Queryable, groupId: string, forUpdate = false): Promise<GroupRow> {
  const r = await db.query<GroupRow>(
    `select g.${COLS.split(', ').join(', g.')} from app.groups g
       join app.organizations o on o.id = g.org_id and o.deleted_at is null
      where g.id = $1 ${forUpdate ? 'for update of g' : ''}`,
    [groupId],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

async function leaderCount(db: Queryable, groupId: string, lock = false) {
  const r = await db.query(`select user_id from app.group_members where group_id = $1 and role = 'leader' ${lock ? 'for update' : ''}`, [groupId]);
  return r.rowCount ?? 0;
}

/** Nạp nhóm + ngữ cảnh người dùng; kiểm tra view(group) → not_found nếu không được xem. */
async function viewGroup(db: Queryable, userId: string, groupId: string, forUpdate = false) {
  const group = await loadGroup(db, groupId, forUpdate);
  const actor = await loadActorContext(db, userId, group.org_id);
  const obj: GroupObject = { type: 'group', id: group.id, orgId: group.org_id, archived: group.archived_at !== null };
  assertAllowed(can(actor, 'group.view', obj));
  return { group, actor, obj };
}

async function members(db: Queryable, groupId: string): Promise<GroupMemberDto[]> {
  const r = await db.query<{ user_id: string; display_name: string; role: GroupRole; added_at: Date }>(
    `select gm.user_id, u.display_name, gm.role, gm.added_at
       from app.group_members gm join app.users u on u.id = gm.user_id
      where gm.group_id = $1
      order by gm.role, u.display_name`,
    [groupId],
  );
  return r.rows.map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role, addedAt: m.added_at.toISOString() }));
}

async function detail(db: Queryable, group: GroupRow, myRole: GroupRole | null): Promise<GroupDetailDto> {
  const list = await members(db, group.id);
  return {
    id: group.id,
    orgId: group.org_id,
    name: group.name,
    description: group.description,
    archived: group.archived_at !== null,
    version: group.version,
    memberCount: list.length,
    myRole,
    members: list,
  };
}

function uniqueNameError(err: unknown): never {
  if ((err as { code?: string }).code === '23505') {
    throw new AppError('validation_failed', 'Tên nhóm đã tồn tại', { fields: { name: 'duplicate' } });
  }
  throw err;
}

export async function listGroups(db: Queryable, userId: string, orgId: string, includeArchived: boolean): Promise<GroupSummaryDto[]> {
  await viewOrg(db, userId, orgId);
  const r = await db.query<GroupRow & { member_count: number; my_role: GroupRole | null }>(
    `select g.${COLS.split(', ').join(', g.')},
            (select count(*)::int from app.group_members x where x.group_id = g.id) as member_count,
            (select role from app.group_members x where x.group_id = g.id and x.user_id = $2) as my_role
       from app.groups g
      where g.org_id = $1 and ($3 or g.archived_at is null)
      order by g.name_norm`,
    [orgId, userId, includeArchived],
  );
  return r.rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    archived: g.archived_at !== null,
    version: g.version,
    memberCount: g.member_count,
    myRole: g.my_role,
  }));
}

export async function getGroup(db: Queryable, userId: string, groupId: string) {
  const { group, actor } = await viewGroup(db, userId, groupId);
  return detail(db, group, actor.groupRoles.get(groupId) ?? null);
}

export async function createGroup(ctx: CommandCtx, orgId: string, input: { name: string; description?: string }) {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId);
  assertAllowed(can(actor, 'group.create', { type: 'organization', id: orgId }));
  const name = input.name.trim();
  const r = await ctx.tx
    .query<GroupRow>(
      `insert into app.groups (org_id, name, name_norm, description, created_by) values ($1, $2, $3, $4, $5) returning ${COLS}`,
      [orgId, name, normalizeText(name), input.description?.trim() || null, ctx.user.id],
    )
    .catch(uniqueNameError);
  const group = r.rows[0]!;
  await emit(ctx, { orgId, verb: 'group.created', object: { type: 'group', id: group.id }, context: { groupId: group.id }, payload: { name } });
  // TODO(F9): tạo Conversation anchor = group khi có module Messaging.
  return detail(ctx.tx, group, null);
}

export async function updateGroup(ctx: CommandCtx, groupId: string, input: { expectedVersion: number; name?: string; description?: string | null }) {
  const { group, actor, obj } = await viewGroup(ctx.tx, ctx.user.id, groupId, true);
  assertAllowed(can(actor, 'group.update', obj));
  const myRole = actor.groupRoles.get(groupId) ?? null;
  if (group.version !== input.expectedVersion) {
    throw new AppError('version_conflict', 'Nhóm đã được người khác sửa', { current: await detail(ctx.tx, group, myRole) });
  }
  const name = input.name?.trim() ?? group.name;
  const description = input.description === undefined ? group.description : input.description?.trim() || null;
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (name !== group.name) changes.name = { before: group.name, after: name };
  if (description !== group.description) changes.description = { before: group.description, after: description };
  if (!Object.keys(changes).length) return detail(ctx.tx, group, myRole);

  const r = await ctx.tx
    .query<GroupRow>(
      `update app.groups set name = $2, name_norm = $3, description = $4, version = version + 1 where id = $1 returning ${COLS}`,
      [groupId, name, normalizeText(name), description],
    )
    .catch(uniqueNameError);
  await emit(
    ctx,
    { orgId: group.org_id, verb: 'group.updated', object: { type: 'group', id: groupId }, context: { groupId }, payload: { changes } },
    [topics.group(groupId)],
  );
  return detail(ctx.tx, r.rows[0]!, myRole);
}

export async function archiveGroup(ctx: CommandCtx, groupId: string, expectedVersion: number) {
  const { group, actor, obj } = await viewGroup(ctx.tx, ctx.user.id, groupId, true);
  assertAllowed(can(actor, 'group.archive', obj));
  const myRole = actor.groupRoles.get(groupId) ?? null;
  if (group.version !== expectedVersion) {
    throw new AppError('version_conflict', 'Nhóm đã được người khác sửa', { current: await detail(ctx.tx, group, myRole) });
  }
  const r = await ctx.tx.query<GroupRow>(
    `update app.groups set archived_at = now(), version = version + 1 where id = $1 returning ${COLS}`,
    [groupId],
  );
  await emit(ctx, { orgId: group.org_id, verb: 'group.archived', object: { type: 'group', id: groupId }, context: { groupId } }, [
    topics.group(groupId),
  ]);
  // TODO(F9): chuyển hội thoại nhóm sang chỉ-đọc.
  return detail(ctx.tx, r.rows[0]!, myRole);
}

export async function addGroupMember(ctx: CommandCtx, groupId: string, input: { userId: string; role: GroupRole }) {
  const { group, actor, obj } = await viewGroup(ctx.tx, ctx.user.id, groupId, true);
  assertAllowed(can(actor, 'group.members.manage', obj));
  const m = await ctx.tx.query(`select 1 from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`, [
    group.org_id,
    input.userId,
  ]);
  if (!m.rowCount) throw new AppError('not_a_member', 'Người này không phải thành viên của tổ chức');

  const r = await ctx.tx.query(
    `insert into app.group_members (group_id, user_id, org_id, role, added_by) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning user_id`,
    [groupId, input.userId, group.org_id, input.role, ctx.user.id],
  );
  if (r.rowCount) {
    const activityId = await emit(
      ctx,
      {
        orgId: group.org_id,
        verb: 'group.member_added',
        object: { type: 'group', id: groupId },
        context: { groupId },
        payload: { user_id: input.userId, role: input.role },
      },
      [topics.group(groupId)],
    );
    await signalAccessChanged(ctx, input.userId, { type: 'group', id: groupId, activityId });
  }
  return detail(ctx.tx, group, actor.groupRoles.get(groupId) ?? (input.userId === ctx.user.id ? input.role : null));
}

export async function setGroupMemberRole(ctx: CommandCtx, groupId: string, userId: string, role: GroupRole) {
  const { group, actor, obj } = await viewGroup(ctx.tx, ctx.user.id, groupId, true);
  assertAllowed(can(actor, 'group.members.manage', obj));
  const cur = await ctx.tx.query<{ role: GroupRole }>(`select role from app.group_members where group_id = $1 and user_id = $2 for update`, [
    groupId,
    userId,
  ]);
  if (!cur.rows[0]) throw notFound();
  if (cur.rows[0].role !== role) {
    await ctx.tx.query(`update app.group_members set role = $3 where group_id = $1 and user_id = $2`, [groupId, userId, role]);
    await emit(
      ctx,
      {
        orgId: group.org_id,
        verb: 'group.member_role_changed',
        object: { type: 'group', id: groupId },
        context: { groupId },
        payload: { user_id: userId, before: cur.rows[0].role, after: role },
      },
      [topics.group(groupId)],
    );
  }
  const fresh = await loadActorContext(ctx.tx, ctx.user.id, group.org_id);
  return detail(ctx.tx, group, fresh.groupRoles.get(groupId) ?? null);
}

/** Gỡ thành viên khỏi nhóm (người quản lý) hoặc tự rời (bySelf). Người bị gỡ mất quyền đọc hội thoại nhóm ngay. */
export async function removeGroupMember(ctx: CommandCtx, groupId: string, userId: string, bySelf: boolean) {
  const { group, actor, obj } = await viewGroup(ctx.tx, ctx.user.id, groupId, true);
  if (bySelf) {
    assertAllowed(can(actor, 'group.leave', { ...obj, leaderCount: await leaderCount(ctx.tx, groupId, true) }));
  } else {
    assertAllowed(can(actor, 'group.members.manage', obj));
  }
  const r = await ctx.tx.query(`delete from app.group_members where group_id = $1 and user_id = $2 returning role`, [groupId, userId]);
  if (!r.rowCount) throw notFound();
  const activityId = await emit(
    ctx,
    {
      orgId: group.org_id,
      verb: 'group.member_removed',
      object: { type: 'group', id: groupId },
      context: { groupId },
      payload: { user_id: userId, by_self: bySelf },
    },
    [topics.group(groupId)],
  );
  await signalAccessChanged(ctx, userId, { type: 'group', id: groupId, activityId });
  // TODO(F11): nhắc org admin khi nhóm không còn leader (PERMISSION_MODEL §7).
  return { groupId, userId, removed: true };
}

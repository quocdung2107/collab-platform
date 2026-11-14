import { releaseMemberFromTasks } from '../tasks/hooks.js';
import type { OrgRole } from '@collab/shared';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can } from '../access/can.js';
import { emit, signalAccessChanged } from '../activity/emit.js';
import { releaseMemberFromScheduling } from '../scheduling/membership.js';
import { topics } from '../realtime/publisher.js';
import { viewOrg } from './organizations.js';

/** Khoá mọi dòng owner active của tổ chức để kiểm tra "còn ít nhất một owner" an toàn khi đồng thời. */
async function lockActiveOwners(ctx: CommandCtx, orgId: string): Promise<number> {
  const r = await ctx.tx.query(
    `select user_id from app.memberships where org_id = $1 and role = 'owner' and status = 'active' for update`,
    [orgId],
  );
  return r.rowCount ?? 0;
}

async function loadActiveMembership(ctx: CommandCtx, orgId: string, userId: string) {
  const r = await ctx.tx.query<{ role: OrgRole }>(
    `select role from app.memberships where org_id = $1 and user_id = $2 and status = 'active' for update`,
    [orgId, userId],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

/** Đổi vai trò tổ chức. member↔admin: org admin. Cấp/gỡ owner: chỉ owner. Không gỡ owner cuối cùng. */
export async function changeMemberRole(ctx: CommandCtx, orgId: string, targetId: string, role: OrgRole) {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId, true);
  const owners = await lockActiveOwners(ctx, orgId);
  const target = await loadActiveMembership(ctx, orgId, targetId);
  if (target.role === role) return { userId: targetId, role };

  const touchesOwner = target.role === 'owner' || role === 'owner';
  assertAllowed(can(actor, touchesOwner ? 'org.owners.manage' : 'org.members.set_admin', { type: 'organization', id: orgId }));
  if (target.role === 'owner' && owners <= 1) throw new AppError('forbidden', 'Tổ chức phải còn ít nhất một chủ sở hữu');

  await ctx.tx.query(`update app.memberships set role = $3 where org_id = $1 and user_id = $2`, [orgId, targetId, role]);
  const activityId = await emit(ctx, {
    orgId,
    verb: 'member.role_changed',
    object: { type: 'user', id: targetId },
    payload: { user_id: targetId, before: target.role, after: role },
  });
  await signalAccessChanged(ctx, targetId, { type: 'organization', id: orgId, activityId });
  return { userId: targetId, role };
}

/**
 * Gỡ thành viên (bySelf = false) hoặc rời tổ chức (bySelf = true) — PERMISSION_MODEL §7.
 * Hệ quả đã có trong lát cắt này: gỡ khỏi mọi Group (sự kiện con group.member_removed), Membership → removed,
 * tín hiệu access_changed (AD-31).
 * Lịch: huỷ Assignment tương lai (member_left), gỡ event_owners, xoá Subscription (S7).
 * Task: bỏ owner Task chưa xong (task.assigned về rỗng), gỡ task_collaborators (S10). TODO(S12): thiết bị đẩy, delivery chưa gửi.
 */
export async function removeMember(ctx: CommandCtx, orgId: string, targetId: string, bySelf: boolean) {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId, true);
  const owners = await lockActiveOwners(ctx, orgId);
  if (bySelf) {
    assertAllowed(can(actor, 'org.leave', { type: 'organization', id: orgId, activeOwnerCount: owners }));
  } else {
    if (targetId === ctx.user.id) throw new AppError('validation_failed', 'Dùng thao tác rời tổ chức để tự rời', { fields: { userId: 'self' } });
    assertAllowed(can(actor, 'org.members.remove', { type: 'organization', id: orgId }));
  }
  const target = bySelf ? { role: actor.orgRole! } : await loadActiveMembership(ctx, orgId, targetId);
  if (!bySelf && target.role === 'owner') {
    assertAllowed(can(actor, 'org.owners.manage', { type: 'organization', id: orgId }));
    if (owners <= 1) throw new AppError('forbidden', 'Không thể gỡ chủ sở hữu cuối cùng');
  }

  const rootId = await emit(ctx, {
    orgId,
    verb: 'member.removed',
    object: { type: 'user', id: targetId },
    payload: { user_id: targetId, by_self: bySelf },
  });

  const groups = await ctx.tx.query<{ group_id: string }>(
    `delete from app.group_members where org_id = $1 and user_id = $2 returning group_id`,
    [orgId, targetId],
  );
  for (const g of groups.rows) {
    await emit(
      ctx,
      {
        orgId,
        verb: 'group.member_removed',
        object: { type: 'group', id: g.group_id },
        context: { groupId: g.group_id },
        causeId: rootId,
        payload: { user_id: targetId, by_self: bySelf },
      },
      [topics.group(g.group_id)],
    );
  }

  await releaseMemberFromScheduling(ctx, orgId, targetId, rootId);
  await releaseMemberFromTasks(ctx, orgId, targetId, rootId);

  await ctx.tx.query(
    `update app.memberships set status = 'removed', removed_at = now(), removed_by = $3 where org_id = $1 and user_id = $2`,
    [orgId, targetId, ctx.user.id],
  );
  await signalAccessChanged(ctx, targetId, { type: 'organization', id: orgId, activityId: rootId });
  return { userId: targetId, removed: true, groupsLeft: groups.rows.map((g) => g.group_id) };
}

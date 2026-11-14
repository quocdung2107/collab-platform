import type { MemberDto, OrganizationDto, OrgRole } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, isOrgAdmin, type ActorContext } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { emit } from '../activity/emit.js';

interface OrgRow {
  id: string;
  name: string;
  timezone: string;
  default_event_visibility: 'org' | 'groups';
  reconfirm_threshold_min: number;
  version: number;
}

const toDto = (o: OrgRow, myRole: OrgRole): OrganizationDto => ({
  id: o.id,
  name: o.name,
  timezone: o.timezone,
  defaultEventVisibility: o.default_event_visibility,
  reconfirmThresholdMin: o.reconfirm_threshold_min,
  version: o.version,
  myRole,
});

/** Nạp tổ chức chưa xoá; không có → not_found. forUpdate khoá dòng trong giao dịch. */
export async function loadOrg(db: Queryable, orgId: string, forUpdate = false): Promise<OrgRow> {
  const r = await db.query<OrgRow>(
    `select id, name, timezone, default_event_visibility, reconfirm_threshold_min, version
       from app.organizations where id = $1 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
    [orgId],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

/** Ngữ cảnh + kiểm tra view(organization); dùng cho mọi đọc/ghi trong tổ chức. */
export async function viewOrg(db: Queryable, userId: string, orgId: string, forUpdate = false) {
  const org = await loadOrg(db, orgId, forUpdate);
  const actor = await loadActorContext(db, userId, orgId);
  assertAllowed(can(actor, 'org.view', { type: 'organization', id: orgId }));
  return { org, actor };
}

export async function createOrganization(ctx: CommandCtx, input: { name: string; timezone?: string }) {
  const r = await ctx.tx.query<OrgRow>(
    `insert into app.organizations (name, timezone) values ($1, coalesce($2, 'Asia/Ho_Chi_Minh'))
     returning id, name, timezone, default_event_visibility, reconfirm_threshold_min, version`,
    [input.name.trim(), input.timezone ?? null],
  );
  const org = r.rows[0]!;
  await ctx.tx.query(`insert into app.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [org.id, ctx.user.id]);
  await emit(ctx, { orgId: org.id, verb: 'organization.created', object: { type: 'organization', id: org.id }, payload: { name: org.name } });
  return toDto(org, 'owner');
}

export async function getOrganization(db: Queryable, userId: string, orgId: string) {
  const { org, actor } = await viewOrg(db, userId, orgId);
  return toDto(org, actor.orgRole!);
}

export interface UpdateOrgInput {
  expectedVersion: number;
  name?: string;
  timezone?: string;
  defaultEventVisibility?: 'org' | 'groups';
  reconfirmThresholdMin?: number;
}

export async function updateOrganization(ctx: CommandCtx, orgId: string, input: UpdateOrgInput) {
  const { org, actor } = await viewOrg(ctx.tx, ctx.user.id, orgId, true);
  assertAllowed(can(actor, 'org.update', { type: 'organization', id: orgId }));
  if (org.version !== input.expectedVersion) {
    throw new AppError('version_conflict', 'Tổ chức đã được người khác sửa', { current: toDto(org, actor.orgRole!) });
  }
  const next = {
    name: input.name?.trim() ?? org.name,
    timezone: input.timezone ?? org.timezone,
    default_event_visibility: input.defaultEventVisibility ?? org.default_event_visibility,
    reconfirm_threshold_min: input.reconfirmThresholdMin ?? org.reconfirm_threshold_min,
  };
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(next) as Array<keyof typeof next>) {
    if (next[k] !== org[k]) changes[k] = { before: org[k], after: next[k] };
  }
  if (Object.keys(changes).length === 0) return toDto(org, actor.orgRole!);

  const r = await ctx.tx.query<OrgRow>(
    `update app.organizations
        set name = $2, timezone = $3, default_event_visibility = $4, reconfirm_threshold_min = $5, version = version + 1
      where id = $1
      returning id, name, timezone, default_event_visibility, reconfirm_threshold_min, version`,
    [orgId, next.name, next.timezone, next.default_event_visibility, next.reconfirm_threshold_min],
  );
  await emit(ctx, { orgId, verb: 'organization.updated', object: { type: 'organization', id: orgId }, payload: { changes } });
  return toDto(r.rows[0]!, actor.orgRole!);
}

export async function listMembers(db: Queryable, userId: string, orgId: string): Promise<MemberDto[]> {
  const { actor } = await viewOrg(db, userId, orgId);
  const r = await db.query<{
    user_id: string;
    display_name: string;
    role: OrgRole;
    joined_at: Date;
    email: string | null;
    phone: string | null;
    contact_visibility: 'org' | 'managers' | 'hidden';
  }>(
    `select m.user_id, u.display_name, m.role, m.joined_at, u.email, u.phone, u.contact_visibility
       from app.memberships m join app.users u on u.id = m.user_id
      where m.org_id = $1 and m.status = 'active'
      order by u.display_name`,
    [orgId],
  );
  return r.rows.map((m) => {
    const visible = contactVisible(actor, m.user_id, m.contact_visibility);
    return {
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role,
      joinedAt: m.joined_at.toISOString(),
      email: visible ? m.email : null,
      phone: visible ? m.phone : null,
    };
  });
}

/** view(user): thông tin liên hệ theo cài đặt hiển thị của người đó (PERMISSION_MODEL §3). */
function contactVisible(viewer: ActorContext, subjectId: string, visibility: 'org' | 'managers' | 'hidden') {
  if (viewer.userId === subjectId) return true;
  if (visibility === 'org') return true;
  if (visibility === 'managers') return isOrgAdmin(viewer);
  return false;
}

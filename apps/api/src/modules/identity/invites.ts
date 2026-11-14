import { createHash, randomBytes } from 'node:crypto';
import type { AcceptInviteResult, CreatedInviteDto, InviteDto, InvitePreviewDto, InviteStatus } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { topics } from '../realtime/publisher.js';
import { viewOrg } from './organizations.js';

/** Liên kết mời: token ngẫu nhiên 256 bit, chỉ lưu SHA-256 (T13). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface InviteRow {
  id: string;
  org_id: string;
  role: 'admin' | 'member';
  group_id: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const toDto = (i: InviteRow): InviteDto => ({
  id: i.id,
  role: i.role,
  groupId: i.group_id,
  maxUses: i.max_uses,
  usedCount: i.used_count,
  expiresAt: i.expires_at.toISOString(),
  createdAt: i.created_at.toISOString(),
});

function statusOf(i: InviteRow, now = new Date()): InviteStatus {
  if (i.revoked_at) return 'revoked';
  if (i.expires_at <= now) return 'expired';
  if (i.max_uses !== null && i.used_count >= i.max_uses) return 'used_up';
  return 'valid';
}

const COLS = 'id, org_id, role, group_id, max_uses, used_count, expires_at, revoked_at, created_at';

export interface CreateInviteInput {
  role: 'admin' | 'member';
  groupId?: string;
  maxUses?: number;
  expiresInHours: number;
}

export async function createInvite(ctx: CommandCtx, orgId: string, input: CreateInviteInput): Promise<CreatedInviteDto> {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId);
  assertAllowed(can(actor, 'org.invites.manage', { type: 'organization', id: orgId }));
  if (input.groupId) {
    const g = await ctx.tx.query(`select 1 from app.groups where id = $1 and org_id = $2 and archived_at is null`, [input.groupId, orgId]);
    if (!g.rowCount) throw new AppError('validation_failed', 'Nhóm không tồn tại', { fields: { groupId: 'not_found' } });
  }
  const token = randomBytes(32).toString('base64url');
  const r = await ctx.tx.query<InviteRow>(
    `insert into app.invites (org_id, token_hash, role, group_id, max_uses, expires_at, created_by)
     values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7)
     returning ${COLS}`,
    [orgId, hashToken(token), input.role, input.groupId ?? null, input.maxUses ?? null, input.expiresInHours, ctx.user.id],
  );
  const invite = r.rows[0]!;
  await emit(ctx, {
    orgId,
    verb: 'member.invited',
    object: { type: 'invite', id: invite.id },
    context: input.groupId ? { groupId: input.groupId } : undefined,
    payload: { invite_id: invite.id, role: invite.role, group_id: invite.group_id },
  });
  return { ...toDto(invite), token };
}

export async function listInvites(db: Queryable, userId: string, orgId: string): Promise<InviteDto[]> {
  const { actor } = await viewOrg(db, userId, orgId);
  assertAllowed(can(actor, 'org.invites.manage', { type: 'organization', id: orgId }));
  const r = await db.query<InviteRow>(
    `select ${COLS} from app.invites
      where org_id = $1 and revoked_at is null and expires_at > now()
        and (max_uses is null or used_count < max_uses)
      order by created_at desc`,
    [orgId],
  );
  return r.rows.map(toDto);
}

export async function revokeInvite(ctx: CommandCtx, orgId: string, inviteId: string) {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId);
  assertAllowed(can(actor, 'org.invites.manage', { type: 'organization', id: orgId }));
  const r = await ctx.tx.query<InviteRow>(
    `update app.invites set revoked_at = coalesce(revoked_at, now()) where id = $1 and org_id = $2 returning ${COLS}`,
    [inviteId, orgId],
  );
  if (!r.rows[0]) throw notFound();
  await emit(ctx, { orgId, verb: 'invite.revoked', object: { type: 'invite', id: inviteId }, payload: { invite_id: inviteId } });
  return toDto(r.rows[0]);
}

async function findByToken(db: Queryable, token: string, forUpdate: boolean) {
  if (!TOKEN_RE.test(token)) throw notFound();
  const r = await db.query<InviteRow & { org_name: string }>(
    `select i.${COLS.split(', ').join(', i.')}, o.name as org_name
       from app.invites i join app.organizations o on o.id = i.org_id and o.deleted_at is null
      where i.token_hash = $1 ${forUpdate ? 'for update of i' : ''}`,
    [hashToken(token)],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

/** Xem trước liên kết mời (người đã đăng nhập, có token). Token chính là bí mật nên được biết tên tổ chức. */
export async function previewInvite(db: Queryable, userId: string, token: string): Promise<InvitePreviewDto> {
  const i = await findByToken(db, token, false);
  const m = await db.query(`select 1 from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`, [i.org_id, userId]);
  return { orgName: i.org_name, status: statusOf(i), alreadyMember: (m.rowCount ?? 0) > 0 };
}

/**
 * Nhận lời mời (F1). Khoá dòng lời mời nên hai người nhận đồng thời một lời mời max_uses = 1
 * thì đúng một người thành công (F1-T2). Đã là thành viên → vào thẳng, không tạo trùng, không trừ lượt (F1-T1).
 */
export async function acceptInvite(ctx: CommandCtx, token: string): Promise<AcceptInviteResult> {
  const invite = await findByToken(ctx.tx, token, true);
  const orgId = invite.org_id;

  const existing = await ctx.tx.query<{ status: 'active' | 'removed' }>(
    `select status from app.memberships where org_id = $1 and user_id = $2 for update`,
    [orgId, ctx.user.id],
  );
  if (existing.rows[0]?.status === 'active') return { orgId, alreadyMember: true, groupId: null };

  const status = statusOf(invite);
  if (status !== 'valid') {
    const message = { expired: 'Liên kết mời đã hết hạn', revoked: 'Liên kết mời đã bị thu hồi', used_up: 'Liên kết mời đã hết lượt dùng' }[status];
    throw new AppError('state_conflict', message, { current: { inviteStatus: status } });
  }

  if (existing.rows[0]) {
    await ctx.tx.query(
      `update app.memberships set status = 'active', role = $3, joined_at = now(), removed_at = null, removed_by = null
        where org_id = $1 and user_id = $2`,
      [orgId, ctx.user.id, invite.role],
    );
  } else {
    await ctx.tx.query(`insert into app.memberships (org_id, user_id, role) values ($1, $2, $3)`, [orgId, ctx.user.id, invite.role]);
  }
  await ctx.tx.query(`update app.invites set used_count = used_count + 1 where id = $1`, [invite.id]);

  const rootId = await emit(ctx, {
    orgId,
    verb: 'member.joined',
    object: { type: 'user', id: ctx.user.id },
    payload: { user_id: ctx.user.id, role: invite.role, invite_id: invite.id, group_id: invite.group_id },
  });

  let groupId: string | null = null;
  if (invite.group_id) {
    const g = await ctx.tx.query(
      `insert into app.group_members (group_id, user_id, org_id, role, added_by)
       select id, $2, org_id, 'member', $3 from app.groups where id = $1 and archived_at is null
       on conflict do nothing returning group_id`,
      [invite.group_id, ctx.user.id, (await inviterOf(ctx, invite.id)) ?? ctx.user.id],
    );
    if (g.rowCount) {
      groupId = invite.group_id;
      await emit(
        ctx,
        {
          orgId,
          verb: 'group.member_added',
          object: { type: 'group', id: groupId },
          context: { groupId },
          causeId: rootId,
          payload: { user_id: ctx.user.id, role: 'member' },
        },
        [topics.group(groupId)],
      );
    }
  }
  return { orgId, alreadyMember: false, groupId };
}

async function inviterOf(ctx: CommandCtx, inviteId: string) {
  const r = await ctx.tx.query<{ created_by: string }>(`select created_by from app.invites where id = $1`, [inviteId]);
  return r.rows[0]?.created_by ?? null;
}

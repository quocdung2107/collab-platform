import type { GroupRole, OrgRole } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { ActorContext } from './can.js';

/** Nạp ngữ cảnh quyền của một người dùng trong một tổ chức. Hai truy vấn có chỉ mục. */
export async function loadActorContext(db: Queryable, userId: string, orgId: string): Promise<ActorContext> {
  const m = await db.query<{ role: OrgRole }>(
    `select role from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`,
    [orgId, userId],
  );
  const orgRole = m.rows[0]?.role ?? null;
  if (orgRole === null) return { userId, orgId, orgRole: null, groupRoles: new Map() };

  const g = await db.query<{ group_id: string; role: GroupRole }>(
    `select group_id, role from app.group_members where org_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  return { userId, orgId, orgRole, groupRoles: new Map(g.rows.map((r) => [r.group_id, r.role])) };
}

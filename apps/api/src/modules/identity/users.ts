import type { MeResponse, OrgRole } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { AuthIdentity } from '../../http/auth.js';

export interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  locale: string;
}

/**
 * Tìm hoặc tạo users theo auth_subject (AD-26). Lần đăng nhập đầu tạo hồ sơ nội bộ;
 * các lần sau không ghi đè tên người dùng đã tự sửa.
 * Email chỉ được gán nếu chưa ai dùng, để không vi phạm UNIQUE khi hai danh tính trùng email.
 */
export async function provisionUser(db: Queryable, id: AuthIdentity): Promise<UserRow> {
  const name = id.displayName ?? id.email?.split('@')[0] ?? 'Thành viên mới';
  const r = await db.query<UserRow>(
    `with ins as (
       insert into app.users (auth_subject, display_name, email)
       values ($1, $2, case when $3::text is null or exists (select 1 from app.users where email = $3) then null else $3 end)
       on conflict (auth_subject) do nothing
       returning id, display_name, email, locale)
     select * from ins
     union all
     select id, display_name, email, locale from app.users where auth_subject = $1
     limit 1`,
    [id.subject, name, id.email],
  );
  return r.rows[0]!;
}

export async function getMe(db: Queryable, user: UserRow): Promise<MeResponse> {
  const m = await db.query<{ org_id: string; name: string; role: OrgRole }>(
    `select m.org_id, o.name, m.role
       from app.memberships m join app.organizations o on o.id = m.org_id
      where m.user_id = $1 and m.status = 'active' and o.deleted_at is null
      order by m.joined_at`,
    [user.id],
  );
  return {
    user: { id: user.id, displayName: user.display_name, email: user.email, locale: user.locale },
    memberships: m.rows.map((r) => ({ orgId: r.org_id, orgName: r.name, role: r.role })),
  };
}

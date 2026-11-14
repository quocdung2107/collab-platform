import type { Queryable } from '../../db/pool.js';

export interface Prefs {
  pushActionRequired: boolean;
  pushDirect: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}
export const DEFAULT_PREFS: Prefs = { pushActionRequired: true, pushDirect: true, quietHoursEnabled: true, quietStart: '22:00', quietEnd: '06:30' };

export async function loadPrefs(db: Queryable, userId: string): Promise<Prefs> {
  const r = await db.query<{ a: boolean; d: boolean; q: boolean; s: string; e: string }>(
    `select push_action_required as a, push_direct as d, quiet_hours_enabled as q, to_char(quiet_start, 'HH24:MI') as s, to_char(quiet_end, 'HH24:MI') as e
       from app.notification_preferences where user_id = $1`,
    [userId],
  );
  const p = r.rows[0];
  return p ? { pushActionRequired: p.a, pushDirect: p.d, quietHoursEnabled: p.q, quietStart: p.s, quietEnd: p.e } : DEFAULT_PREFS;
}

export async function savePrefs(db: Queryable, userId: string, p: Prefs): Promise<Prefs> {
  await db.query(
    `insert into app.notification_preferences (user_id, push_action_required, push_direct, quiet_hours_enabled, quiet_start, quiet_end)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set push_action_required = excluded.push_action_required, push_direct = excluded.push_direct,
       quiet_hours_enabled = excluded.quiet_hours_enabled, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now()`,
    [userId, p.pushActionRequired, p.pushDirect, p.quietHoursEnabled, p.quietStart, p.quietEnd],
  );
  return loadPrefs(db, userId);
}

/** Lớp có được đẩy theo công tắc không. Chat đi theo công tắc "cập nhật" (push_direct). */
export const allows = (p: Prefs, cls: 'action_required' | 'direct' | 'chat') => (cls === 'action_required' ? p.pushActionRequired : p.pushDirect);

/** Múi giờ người dùng → tổ chức → mặc định (§8.3 "theo múi giờ của người dùng"). */
export async function userTimezone(db: Queryable, userId: string, orgId: string | null) {
  const r = await db.query<{ tz: string | null }>(
    `select coalesce(u.timezone, (select timezone from app.organizations where id = $2)) as tz from app.users u where u.id = $1`,
    [userId, orgId],
  );
  return r.rows[0]?.tz ?? 'Asia/Ho_Chi_Minh';
}

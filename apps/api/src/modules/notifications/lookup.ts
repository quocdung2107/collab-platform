import type { Queryable } from '../../db/pool.js';

/** Tra tên để dựng câu (dòng hệ thống, hộp thông báo). Không dùng cho quyết định quyền. */
export function lookup(db: Queryable) {
  const userCache = new Map<string, string>();
  return {
    async userName(id: string | null | undefined) {
      if (!id) return 'Hệ thống';
      if (!userCache.has(id)) {
        const r = await db.query<{ display_name: string }>(`select display_name from app.users where id = $1`, [id]);
        userCache.set(id, r.rows[0]?.display_name ?? 'Một thành viên');
      }
      return userCache.get(id)!;
    },
    async positionName(id: string | null | undefined) {
      if (!id) return 'vị trí';
      const r = await db.query<{ name: string }>(`select name from app.positions where id = $1`, [id]);
      return r.rows[0]?.name ?? 'vị trí';
    },
    async orgTimezone(orgId: string) {
      const r = await db.query<{ timezone: string }>(`select timezone from app.organizations where id = $1`, [orgId]);
      return r.rows[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
    },
  };
}
export type Lookup = ReturnType<typeof lookup>;

/** "CN 16/11 09:00" theo múi giờ tổ chức. */
export function when(iso: string | Date | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('vi-VN', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day} ${time}`;
}

export const CANCEL_REASON: Record<string, string> = {
  removed: 'được gỡ',
  replaced: 'được thay người',
  event_cancelled: 'buổi bị huỷ',
  position_removed: 'vị trí bị bỏ',
  member_left: 'đã rời tổ chức',
};

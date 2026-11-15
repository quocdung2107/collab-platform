import type { Queryable } from '../../db/pool.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type ActorContext, type EventObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';

export interface EventRow {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: Date;
  ends_at: Date;
  status: 'draft' | 'published' | 'cancelled';
  visibility: 'org' | 'groups';
  template_id: string | null;
  copied_from: string | null;
  created_by: string;
  published_at: Date | null;
  version: number;
  series_id: string | null;
  detached_at: Date | null;
}

export const EVENT_COLS =
  'id, org_id, title, description, location, starts_at, ends_at, status, visibility, template_id, copied_from, created_by, published_at, version, series_id, detached_at';

/** Biểu thức SQL cho cột detached_at: lệnh từ Nhịp giữ nguyên, sửa tay một buổi thuộc nhịp thì đánh dấu đã sửa riêng (AD-32). */
export const DETACH = (fromSeriesParam: string) =>
  `case when ${fromSeriesParam}::boolean then detached_at when series_id is not null then coalesce(detached_at, now()) else detached_at end`;

/** Trạng thái Assignment chiếm chỗ trong Position (OD-15). */
export const OCCUPYING = ['draft', 'requested', 'accepted', 'reconfirm'] as const;
/** Assignment "đang hiệu lực" cho view(event) visibility = groups: đã gửi tới người được xếp. */
export const ACTIVE = ['requested', 'accepted', 'reconfirm'] as const;

/** Dựng EventObject cho nhiều Event cùng lúc (3 truy vấn có chỉ mục). */
export async function eventObjects(db: Queryable, rows: EventRow[]): Promise<Map<string, EventObject>> {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, EventObject>();
  if (!ids.length) return out;
  const [groups, owners, assignees] = await Promise.all([
    db.query<{ event_id: string; group_id: string }>(`select event_id, group_id from app.event_groups where event_id = any($1::uuid[])`, [ids]),
    db.query<{ event_id: string; user_id: string }>(`select event_id, user_id from app.event_owners where event_id = any($1::uuid[])`, [ids]),
    // Buổi đã huỷ: người có vị trí lúc huỷ vẫn xem được để đọc thông báo huỷ (F7-T8, IN-28).
    db.query<{ event_id: string; user_id: string }>(
      `select distinct event_id, user_id from app.assignments
        where event_id = any($1::uuid[]) and (status = any($2::text[]) or (status = 'cancelled' and cancel_reason = 'event_cancelled'))`,
      [ids, ACTIVE],
    ),
  ]);
  for (const r of rows) {
    out.set(r.id, {
      type: 'event',
      id: r.id,
      orgId: r.org_id,
      status: r.status,
      visibility: r.visibility,
      groupIds: groups.rows.filter((g) => g.event_id === r.id).map((g) => g.group_id),
      ownerIds: owners.rows.filter((o) => o.event_id === r.id).map((o) => o.user_id),
      activeAssigneeIds: assignees.rows.filter((a) => a.event_id === r.id).map((a) => a.user_id),
    });
  }
  return out;
}

/** Nạp Event + ngữ cảnh người dùng; không xem được → not_found (AD-12). */
export async function viewEvent(db: Queryable, userId: string, eventId: string, forUpdate = false) {
  const r = await db.query<EventRow>(
    `select e.${EVENT_COLS.split(', ').join(', e.')} from app.events e
       join app.organizations o on o.id = e.org_id and o.deleted_at is null
      where e.id = $1 ${forUpdate ? 'for update of e' : ''}`,
    [eventId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  const obj = (await eventObjects(db, [row])).get(row.id)!;
  const actor: ActorContext = await loadActorContext(db, userId, row.org_id);
  assertAllowed(can(actor, 'event.view', obj));
  return { row, obj, actor };
}

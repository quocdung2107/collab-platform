import type { MemberProfileDto } from '@collab/shared';
import { notFound } from '../../http/validate.js';
import type { Queryable } from '../../db/pool.js';
import { viewsEvent } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { listMembers } from '../identity/organizations.js';
import { EVENT_COLS, eventObjects, type EventRow } from '../scheduling/access.js';

/**
 * Hồ sơ thành viên (UX §4.7): người gọi phải là thành viên cùng tổ chức (listMembers kiểm view(organization) và
 * lọc liên hệ theo cài đặt của người được xem). "Sắp phục vụ" chỉ gồm buổi người gọi xem được và vị trí đã gửi/đã nhận.
 */
export async function getMemberProfile(db: Queryable, viewerId: string, orgId: string, userId: string): Promise<MemberProfileDto> {
  const members = await listMembers(db, viewerId, orgId);
  const member = members.find((m) => m.userId === userId);
  if (!member) throw notFound();

  const groups = await db.query<{ id: string; name: string; role: 'leader' | 'member' }>(
    `select g.id, g.name, gm.role from app.group_members gm join app.groups g on g.id = gm.group_id
      where gm.user_id = $1 and g.org_id = $2 and g.archived_at is null order by g.name_norm`,
    [userId, orgId],
  );

  const asg = await db.query<{ event_id: string; position_name: string; status: 'requested' | 'accepted' | 'reconfirm'; report_offset_min: number }>(
    `select a.event_id, p.name as position_name, a.status, p.report_offset_min
       from app.assignments a join app.positions p on p.id = a.position_id and p.removed_at is null
       join app.events e on e.id = a.event_id and e.org_id = $2 and e.status = 'published' and e.deleted_at is null and e.ends_at > now()
      where a.user_id = $1 and a.status in ('requested', 'accepted', 'reconfirm')
      order by e.starts_at limit 100`,
    [userId, orgId],
  );
  const eventIds = [...new Set(asg.rows.map((a) => a.event_id))];
  const events = eventIds.length ? (await db.query<EventRow>(`select ${EVENT_COLS} from app.events where id = any($1::uuid[])`, [eventIds])).rows : [];
  const actor = await loadActorContext(db, viewerId, orgId);
  const objs = await eventObjects(db, events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const upcoming = asg.rows
    .filter((a) => viewsEvent(actor, objs.get(a.event_id)!))
    .slice(0, 20)
    .map((a) => {
      const e = byId.get(a.event_id)!;
      return {
        eventId: e.id,
        eventTitle: e.title,
        startsAt: new Date(e.starts_at.getTime() + a.report_offset_min * 60_000).toISOString(),
        positionName: a.position_name,
        status: a.status,
      };
    });
  return { member, groups: groups.rows.map((g) => ({ id: g.id, name: g.name, role: g.role })), upcoming };
}

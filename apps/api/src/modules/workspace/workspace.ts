import type { ShortPositionDto, WorkspaceAssignmentDto, WorkspaceDto, WorkspaceTaskDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import { unreadDirect } from '../notifications/inbox.js';

const HORIZON_DAYS = 14;

interface ARow {
  id: string;
  status: WorkspaceAssignmentDto['status'];
  org_id: string;
  org_name: string;
  event_id: string;
  title: string;
  starts_at: Date;
  location: string | null;
  position_name: string;
  group_name: string | null;
  report_at: Date;
}

const toAssignment = (r: ARow): WorkspaceAssignmentDto => ({
  kind: 'assignment',
  id: r.id,
  status: r.status,
  orgId: r.org_id,
  orgName: r.org_name,
  eventId: r.event_id,
  eventTitle: r.title,
  startsAt: r.starts_at.toISOString(),
  location: r.location,
  positionName: r.position_name,
  groupName: r.group_name,
  reportAt: r.report_at.toISOString(),
});

/** Nguồn Task cho My Workspace; module Task đăng ký ở S10. */
export interface TaskSource {
  needsResponse(db: Queryable, userId: string): Promise<WorkspaceTaskDto[]>;
  upcoming(db: Queryable, userId: string, horizon: Date): Promise<WorkspaceTaskDto[]>;
  declinedByOthers(db: Queryable, userId: string): Promise<NonNullable<WorkspaceDto['coordinate']>['declinedTasks']>;
}
let taskSource: TaskSource | null = null;
export const registerTaskSource = (s: TaskSource) => {
  taskSource = s;
};

/**
 * My Workspace (F12): đọc thẳng dữ liệu nghiệp vụ của mọi tổ chức người dùng đang tham gia (F12-T1, T2).
 * Chỉ dữ liệu của chính mình; buổi đã huỷ hay vị trí bị bỏ tự biến mất vì không còn trạng thái hiệu lực.
 */
export async function getWorkspace(db: Queryable, userId: string): Promise<WorkspaceDto> {
  const horizon = new Date(Date.now() + HORIZON_DAYS * 24 * 3600_000);
  const assignments = await db.query<ARow>(
    `select a.id, a.status, e.org_id, o.name as org_name, e.id as event_id, e.title, e.starts_at, e.location,
            p.name as position_name, g.name as group_name, e.starts_at + make_interval(mins => p.report_offset_min) as report_at
       from app.assignments a
       join app.events e on e.id = a.event_id and e.status = 'published'
       join app.positions p on p.id = a.position_id and p.removed_at is null
       left join app.groups g on g.id = p.group_id
       join app.organizations o on o.id = e.org_id and o.deleted_at is null
       join app.memberships m on m.org_id = e.org_id and m.user_id = a.user_id and m.status = 'active'
      where a.user_id = $1 and a.status in ('requested', 'reconfirm', 'accepted') and e.ends_at > now()
      order by report_at`,
    [userId],
  );
  const mine = assignments.rows.map(toAssignment);
  const tasksPending = taskSource ? await taskSource.needsResponse(db, userId) : [];
  const tasksUpcoming = taskSource ? await taskSource.upcoming(db, userId, horizon) : [];

  const needsResponse = [...mine.filter((a) => a.status !== 'accepted'), ...tasksPending];
  const upcoming = sortUpcoming([...mine.filter((a) => a.status === 'accepted' && new Date(a.reportAt) <= horizon), ...tasksUpcoming]);

  const short = await db.query<{
    event_id: string;
    title: string;
    starts_at: Date;
    org_name: string;
    position_id: string;
    position_name: string;
    group_name: string | null;
    slots: number;
    filled: number;
  }>(
    `select e.id as event_id, e.title, e.starts_at, o.name as org_name, p.id as position_id, p.name as position_name, g.name as group_name, p.slots,
            (select count(*)::int from app.assignments x where x.position_id = p.id and x.status in ('draft', 'requested', 'accepted', 'reconfirm')) as filled
       from app.positions p
       join app.events e on e.id = p.event_id and e.status <> 'cancelled' and e.starts_at > now()
       join app.organizations o on o.id = e.org_id and o.deleted_at is null
       join app.memberships m on m.org_id = e.org_id and m.user_id = $1 and m.status = 'active'
       left join app.groups g on g.id = p.group_id
      where p.removed_at is null
        and (exists (select 1 from app.event_owners eo where eo.event_id = e.id and eo.user_id = $1)
             or exists (select 1 from app.group_members gm where gm.group_id = p.group_id and gm.user_id = $1 and gm.role = 'leader'))
        and (select count(*) from app.assignments x where x.position_id = p.id and x.status in ('draft', 'requested', 'accepted', 'reconfirm')) < p.slots
      order by e.starts_at, p.sort
      limit 50`,
    [userId],
  );
  const shortPositions: ShortPositionDto[] = short.rows.map((r) => ({
    eventId: r.event_id,
    eventTitle: r.title,
    startsAt: r.starts_at.toISOString(),
    orgName: r.org_name,
    positionId: r.position_id,
    positionName: r.position_name,
    groupName: r.group_name,
    slots: r.slots,
    filled: r.filled,
  }));
  const declinedTasks = taskSource ? await taskSource.declinedByOthers(db, userId) : [];
  const coordinates = await db.query(
    `select 1 from app.event_owners eo join app.events e on e.id = eo.event_id where eo.user_id = $1 and e.status <> 'cancelled'
     union all select 1 from app.group_members where user_id = $1 and role = 'leader' limit 1`,
    [userId],
  );
  const firstOrg = await db.query<{ org_id: string }>(
    `select org_id from app.memberships where user_id = $1 and status = 'active' order by joined_at limit 1`,
    [userId],
  );

  return {
    needsResponse,
    upcoming,
    news: await unreadDirect(db, userId, 10),
    coordinate: coordinates.rowCount || shortPositions.length || declinedTasks.length ? { shortPositions, declinedTasks } : null,
    firstOrgId: firstOrg.rows[0]?.org_id ?? null,
  };
}

/** F12-T3: Task quá hạn lên đầu; còn lại theo giờ có mặt / hạn; Task không hạn cuối cùng. */
export function sortUpcoming(items: Array<WorkspaceAssignmentDto | WorkspaceTaskDto>) {
  const key = (x: WorkspaceAssignmentDto | WorkspaceTaskDto): [number, number] => {
    if (x.kind === 'task') {
      if (x.overdue) return [0, new Date(x.dueAt!).getTime()];
      return x.dueAt ? [1, new Date(x.dueAt).getTime()] : [2, 0];
    }
    return [1, new Date(x.reportAt).getTime()];
  };
  return [...items].sort((a, b) => {
    const [ga, ta] = key(a);
    const [gb, tb] = key(b);
    return ga - gb || ta - tb;
  });
}

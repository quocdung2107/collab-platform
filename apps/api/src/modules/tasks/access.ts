import type { Queryable } from '../../db/pool.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type ActorContext, type TaskObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { EVENT_COLS, eventObjects, type EventRow } from '../scheduling/access.js';

export interface TaskRow {
  id: string;
  org_id: string;
  scope_type: TaskObject['scopeType'];
  event_id: string | null;
  group_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  assigned_by: string | null;
  created_by: string;
  requires_acceptance: boolean;
  acceptance: 'none' | 'pending' | 'accepted' | 'declined';
  decline_reason: string | null;
  status: TaskObject['status'];
  blocked: boolean;
  needs_help: boolean;
  due_at: Date | null;
  due_offset_min: number | null;
  completed_at: Date | null;
  version: number;
}

export const TASK_COLS =
  'id, org_id, scope_type, event_id, group_id, title, description, owner_id, assigned_by, created_by, requires_acceptance, acceptance, decline_reason, status, blocked, needs_help, due_at, due_offset_min, completed_at, version';

/** Dựng TaskObject cho nhiều Task (Event của Task phạm vi event dựng qua eventObjects). */
export async function taskObjects(db: Queryable, rows: TaskRow[]): Promise<Map<string, TaskObject>> {
  const out = new Map<string, TaskObject>();
  if (!rows.length) return out;
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter((x): x is string => !!x))];
  const [events, collabs] = await Promise.all([
    eventIds.length
      ? db.query<EventRow>(`select ${EVENT_COLS} from app.events where id = any($1::uuid[])`, [eventIds]).then((r) => eventObjects(db, r.rows))
      : Promise.resolve(new Map()),
    db.query<{ task_id: string; user_id: string }>(`select task_id, user_id from app.task_collaborators where task_id = any($1::uuid[])`, [rows.map((r) => r.id)]),
  ]);
  for (const r of rows) {
    out.set(r.id, {
      type: 'task',
      id: r.id,
      orgId: r.org_id,
      scopeType: r.scope_type,
      event: r.event_id ? events.get(r.event_id)! : null,
      groupId: r.group_id,
      ownerId: r.owner_id,
      assignedBy: r.assigned_by,
      createdBy: r.created_by,
      collaboratorIds: collabs.rows.filter((c) => c.task_id === r.id).map((c) => c.user_id),
      status: r.status,
    });
  }
  return out;
}

/** Nạp Task + ngữ cảnh người dùng; không xem được → not_found (AD-12). */
export async function viewTask(db: Queryable, userId: string, taskId: string, forUpdate = false): Promise<{ row: TaskRow; obj: TaskObject; actor: ActorContext }> {
  const r = await db.query<TaskRow>(
    `select t.${TASK_COLS.split(', ').join(', t.')} from app.tasks t
       join app.organizations o on o.id = t.org_id and o.deleted_at is null
      where t.id = $1 ${forUpdate ? 'for update of t' : ''}`,
    [taskId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  const obj = (await taskObjects(db, [row])).get(row.id)!;
  const actor = await loadActorContext(db, userId, row.org_id);
  assertAllowed(can(actor, 'task.view', obj));
  return { row, obj, actor };
}

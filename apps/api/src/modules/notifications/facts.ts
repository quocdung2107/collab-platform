import type { Queryable } from '../../db/pool.js';

/**
 * Truy vấn trạng thái hiện tại cho ma trận người nhận (NOTIFICATION_ENGINE §4 bước 2):
 * tập thể (người phụ trách, người theo dõi, người được xếp) lấy từ dữ liệu nghiệp vụ lúc xử lý.
 */
export function facts(db: Queryable) {
  const ids = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id);
  return {
    eventOwners: (eventId: string) => ids(`select user_id as id from app.event_owners where event_id = $1`, [eventId]),
    activeAssignees: (eventId: string) =>
      ids(`select distinct user_id as id from app.assignments where event_id = $1 and status in ('requested', 'accepted', 'reconfirm')`, [eventId]),
    /** position_managers = event_owners ∪ trưởng nhóm của positions.group_id. */
    positionManagers: (positionId: string) =>
      ids(
        `select o.user_id as id from app.positions p join app.event_owners o on o.event_id = p.event_id where p.id = $1
         union
         select gm.user_id from app.positions p join app.group_members gm on gm.group_id = p.group_id and gm.role = 'leader' where p.id = $1`,
        [positionId],
      ),
    subscribers: (targetType: 'event' | 'task', targetId: string) =>
      ids(`select user_id as id from app.subscriptions where target_type = $1 and target_id = $2 and mode = 'follow'`, [targetType, targetId]),
    task: async (taskId: string) =>
      (
        await db.query<{ owner_id: string | null; assigned_by: string | null; event_id: string | null }>(
          `select owner_id, assigned_by, event_id from app.tasks where id = $1`,
          [taskId],
        )
      ).rows[0] ?? null,
    taskCollaborators: (taskId: string) => ids(`select user_id as id from app.task_collaborators where task_id = $1`, [taskId]),
  };
}
export type Facts = ReturnType<typeof facts>;

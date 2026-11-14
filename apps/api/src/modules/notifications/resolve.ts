import type { Tx } from '../../db/pool.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { topics } from '../realtime/publisher.js';
import type { Activity } from './types.js';

type Resolution = 'done' | 'superseded';

/**
 * Giải quyết mục cần hành động (NOTIFICATION_ENGINE §8.7). Trạng thái hành động là hình chiếu của
 * dữ liệu nghiệp vụ: chạy TRƯỚC khi tạo bản ghi mới của cùng sự kiện (vd. giao lại: đóng mục cũ rồi mới tạo mục mới).
 */
export async function applyResolutions(tx: Tx, rt: RealtimePublisher, a: Activity) {
  const p = a.payload;
  const touched: string[] = [];
  const resolve = async (objectType: string, objectIds: string[], how: Resolution, users?: { only?: string[]; except?: string[] }) => {
    if (!objectIds.length) return;
    const r = await tx.query<{ notification_id: string }>(
      `update app.notification_items i set resolved_at = now(), resolution = $3
         from app.notifications n
        where n.id = i.notification_id and i.needs_action and i.resolved_at is null
          and i.object_type = $1 and i.object_id = any($2::uuid[])
          and ($4::uuid[] is null or n.user_id = any($4::uuid[]))
          and ($5::uuid[] is null or n.user_id <> all($5::uuid[]))
        returning i.notification_id`,
      [objectType, objectIds, how, users?.only ?? null, users?.except ?? null],
    );
    touched.push(...r.rows.map((x) => x.notification_id));
  };

  switch (a.verb) {
    case 'assignment.accepted':
    case 'assignment.declined':
      await resolve('assignment', [a.object_id], 'done');
      break;
    case 'assignment.cancelled':
      await resolve('assignment', [a.object_id], 'superseded');
      break;
    case 'position.removed':
      await resolve('position', [a.object_id], 'superseded');
      break;
    case 'event.cancelled': {
      const pos = await tx.query<{ id: string }>(`select id from app.positions where event_id = $1`, [a.event_id]);
      await resolve('position', pos.rows.map((x) => x.id), 'superseded');
      break;
    }
    case 'task.accepted':
    case 'task.declined':
      await resolve('task', [a.object_id], 'done', { only: [a.actor_id!] });
      break;
    case 'task.assigned':
      // Người cũ bị thay → superseded (§8.4); "giao lại" của người giao sau khi bị từ chối → done.
      if (p.from_owner_id) await resolve('task', [a.object_id], 'superseded', { only: [p.from_owner_id] });
      await resolve('task', [a.object_id], 'done', { except: [p.from_owner_id, p.to_owner_id].filter(Boolean) });
      break;
    case 'task.completed':
    case 'task.cancelled':
      await resolve('task', [a.object_id], a.verb === 'task.completed' ? 'done' : 'superseded');
      break;
  }

  // Lấp vị trí: mọi người quản lý cùng được giải quyết khi Position đủ slots (F5-T4).
  if (a.verb.startsWith('assignment.') && p.position_id) {
    const full = await tx.query(
      `select 1 from app.positions p
        where p.id = $1 and p.removed_at is null
          and (select count(*) from app.assignments a where a.position_id = p.id and a.status in ('requested', 'accepted', 'reconfirm')) >= p.slots`,
      [p.position_id],
    );
    if (full.rowCount) await resolve('position', [p.position_id], 'done');
  }

  await settle(tx, rt, touched);
}

/** Bản ghi chuyển khỏi pending khi MỌI mục cần hành động đã xong hoặc bị thay. */
export async function settle(tx: Tx, rt: RealtimePublisher, notificationIds: string[]) {
  if (!notificationIds.length) return;
  const r = await tx.query<{ id: string; user_id: string }>(
    `update app.notifications n
        set action_state = case when exists (select 1 from app.notification_items i where i.notification_id = n.id and i.resolution = 'done')
                                then 'done' else 'superseded' end,
            action_resolved_at = now(), updated_at = now()
      where n.id = any($1::uuid[]) and n.action_state = 'pending'
        and not exists (select 1 from app.notification_items i where i.notification_id = n.id and i.needs_action and i.resolved_at is null)
      returning n.id, n.user_id`,
    [[...new Set(notificationIds)]],
  );
  for (const n of r.rows) await rt.send(tx, topics.user(n.user_id), 'notification.updated', { type: 'notification', id: n.id, verb: 'notification.updated' });
}

import type { Db } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { viewConversation } from '../messaging/conversations.js';
import { viewEvent } from '../scheduling/access.js';
import { canView } from './visibility.js';

export type SubTarget = 'event' | 'task' | 'conversation';
export type SubMode = 'follow' | 'mute' | 'all' | 'mentions';

const MODES: Record<SubTarget, SubMode[]> = { event: ['follow', 'mute'], task: ['follow', 'mute'], conversation: ['all', 'mentions', 'mute'] };

async function orgOf(db: Db, userId: string, type: SubTarget, id: string): Promise<string> {
  if (type === 'event') return (await viewEvent(db, userId, id)).row.org_id;
  if (type === 'conversation') {
    const r = await db.query<{ org_id: string }>(
      `select org_id from app.conversations where id = $1`,
      [id],
    );
    const c = r.rows[0];
    if (!c) throw notFound();
    await viewConversation(db, userId, id);
    return c.org_id;
  }
  const r = await db.query<{ org_id: string }>(`select org_id from app.tasks where id = $1`, [id]);
  if (!r.rows[0] || !(await canView(db, userId, { type: 'task', id }))) throw notFound();
  return r.rows[0].org_id;
}

/** Subscription (NOTIFICATION_ENGINE §6): không ghi ActivityEvent (DATA_MODEL §6). Đòi quyền xem (quy tắc 4). */
export async function setSubscription(db: Db, userId: string, type: SubTarget, id: string, mode: SubMode) {
  if (!MODES[type].includes(mode)) throw new AppError('validation_failed', 'Chế độ không hợp lệ', { fields: { mode: 'invalid' } });
  const orgId = await orgOf(db, userId, type, id);
  await db.query(
    `insert into app.subscriptions (user_id, org_id, target_type, target_id, mode, created_by) values ($1, $2, $3, $4, $5, $1)
     on conflict (user_id, target_type, target_id) do update set mode = excluded.mode`,
    [userId, orgId, type, id, mode],
  );
  return { mode };
}

export async function clearSubscription(db: Db, userId: string, type: SubTarget, id: string) {
  await db.query(`delete from app.subscriptions where user_id = $1 and target_type = $2 and target_id = $3`, [userId, type, id]);
  return { mode: null };
}

export async function getSubscription(db: Db, userId: string, type: SubTarget, id: string) {
  await orgOf(db, userId, type, id);
  const r = await db.query<{ mode: SubMode }>(`select mode from app.subscriptions where user_id = $1 and target_type = $2 and target_id = $3`, [userId, type, id]);
  return { mode: r.rows[0]?.mode ?? null };
}

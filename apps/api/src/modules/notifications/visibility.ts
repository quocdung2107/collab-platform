import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { getGroup } from '../groups/groups.js';
import { viewOrg } from '../identity/organizations.js';
import { viewMessage } from '../messaging/conversations.js';
import { viewEvent } from '../scheduling/access.js';
import type { Target } from './types.js';

/** Bộ kiểm tra quyền xem đối tượng đích theo kiểu; module Task đăng ký ở S10. */
const viewers: Partial<Record<Target['type'], (db: Queryable, userId: string, id: string) => Promise<unknown>>> = {
  event: (db, u, id) => viewEvent(db, u, id),
  message: (db, u, id) => viewMessage(db, u, id),
  group: (db, u, id) => getGroup(db, u, id),
  organization: (db, u, id) => viewOrg(db, u, id),
};

export function registerViewer(type: Target['type'], fn: (db: Queryable, userId: string, id: string) => Promise<unknown>) {
  viewers[type] = fn;
}

/** N3: người nhận phải xem được đối tượng đích. Kiểu chưa có bộ kiểm tra → coi như không xem được. */
export async function canView(db: Queryable, userId: string, t: Target): Promise<boolean> {
  const v = viewers[t.type];
  if (!v) return false;
  try {
    await v(db, userId, t.id);
    return true;
  } catch (e) {
    if (e instanceof AppError && (e.code === 'not_found' || e.code === 'forbidden')) return false;
    throw e;
  }
}

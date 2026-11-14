import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { pushSender } from './sender.js';

/**
 * Chỉ chấp nhận endpoint của dịch vụ đẩy đã biết: Backend sẽ gửi HTTP tới endpoint này,
 * nên URL tuỳ ý là lỗ hổng SSRF (IN-45).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function allowedEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

export interface DeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: 'ios' | 'android' | 'desktop' | 'web';
  installedStandalone: boolean;
}

function requirePush() {
  if (!pushSender()) throw new AppError('unavailable', 'Máy chủ chưa bật thông báo đẩy');
}

/** Đăng ký/làm mới thiết bị. Cùng trình duyệt đăng nhập tài khoản khác → endpoint chuyển sang người mới. */
export async function registerDevice(db: Queryable, userId: string, d: DeviceInput) {
  requirePush();
  if (!allowedEndpoint(d.endpoint)) throw new AppError('validation_failed', 'Dịch vụ đẩy không được hỗ trợ', { fields: { endpoint: 'unsupported' } });
  const r = await db.query<{ id: string }>(
    `insert into app.push_subscriptions (user_id, endpoint, p256dh, auth, platform, installed_standalone)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       platform = excluded.platform, installed_standalone = excluded.installed_standalone,
       last_seen_at = now(), disabled_at = null, disabled_reason = null
     returning id`,
    [userId, d.endpoint, d.keys.p256dh, d.keys.auth, d.platform, d.installedStandalone],
  );
  // Delivery đang chờ của người cũ trên endpoint này không được gửi sang người mới.
  await db.query(
    `update app.notification_deliveries set status = 'cancelled', last_error = 'subscription_replaced', updated_at = now()
      where subscription_id = $1 and status = 'scheduled' and user_id <> $2`,
    [r.rows[0]!.id, userId],
  );
  return { id: r.rows[0]!.id };
}

export async function unregisterDevice(db: Queryable, userId: string, endpoint: string) {
  const r = await db.query<{ id: string }>(
    `update app.push_subscriptions set disabled_at = now(), disabled_reason = 'unsubscribed' where endpoint = $1 and user_id = $2 and disabled_at is null returning id`,
    [endpoint, userId],
  );
  if (r.rows[0]) {
    await db.query(`update app.notification_deliveries set status = 'cancelled', last_error = 'unsubscribed', updated_at = now() where subscription_id = $1 and status = 'scheduled'`, [
      r.rows[0].id,
    ]);
  }
  return { removed: Boolean(r.rowCount) };
}

export async function listDevices(db: Queryable, userId: string) {
  const r = await db.query<{ id: string; endpoint: string; platform: string; installed_standalone: boolean; created_at: Date; last_seen_at: Date }>(
    `select id, endpoint, platform, installed_standalone, created_at, last_seen_at from app.push_subscriptions
      where user_id = $1 and disabled_at is null order by last_seen_at desc`,
    [userId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    endpoint: x.endpoint,
    platform: x.platform,
    installedStandalone: x.installed_standalone,
    createdAt: x.created_at.toISOString(),
    lastSeenAt: x.last_seen_at.toISOString(),
  }));
}

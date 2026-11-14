// Thử nghiệm OD-17: gửi Web Push tới PWA (đặc biệt iPhone đã thêm vào Màn hình chính).
// Supabase Edge Function `push-spike` (Deno), verify_jwt = false vì gọi từ trang thử không đăng nhập.
// Chỉ gửi tới chính thiết bị đã đăng ký; mỗi thiết bị tối đa 20 lần gửi.
// Khoá VAPID riêng của bản thử nằm trong spike.config (chỉ vai trò postgres đọc được); bản thật dùng secret.
import webpush from 'npm:web-push@3.6.7';
import postgres from 'npm:postgres@3.4.7';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const SELF_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/push-spike`;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

let vapidReady = false;
async function ensureVapid() {
  if (vapidReady) return;
  const rows = await sql`select key, value from spike.config where key in ('vapid_public', 'vapid_private', 'vapid_subject')`;
  const c = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  webpush.setVapidDetails(c.vapid_subject, c.vapid_public, c.vapid_private);
  vapidReady = true;
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// deno-lint-ignore no-explicit-any
async function doSend(sub: any, deviceId: string, delay: number) {
  await ensureVapid();
  const [log] = await sql`insert into spike.push_log (device_id, delay_sec) values (${deviceId}, ${delay}) returning id`;
  const payload = JSON.stringify({
    title: 'Collab · thử thông báo',
    body: `Bạn được xếp phục vụ (thử nghiệm, trễ ${delay}s)`,
    logId: log.id,
    ackUrl: SELF_URL,
  });
  try {
    const r = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 3600, urgency: 'high' },
    );
    await sql`update spike.push_log set sent_at = now(), push_status = ${r.statusCode} where id = ${log.id}`;
    return { ok: true, logId: log.id, pushStatus: r.statusCode };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    await sql`update spike.push_log set sent_at = now(), push_status = ${err.statusCode ?? null},
              push_error = ${String(err.body ?? err.message ?? e).slice(0, 500)} where id = ${log.id}`;
    return { ok: false, logId: log.id, pushStatus: err.statusCode, detail: err.body ?? err.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  const deviceId = String(body.deviceId ?? '');

  try {
    switch (body.action) {
      case 'subscribe': {
        const s = body.subscription;
        if (!deviceId || !s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ error: 'invalid subscription' }, 400);
        await sql`insert into spike.push_subscriptions (device_id, endpoint, p256dh, auth, ua, standalone)
                  values (${deviceId}, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth}, ${String(body.ua ?? '')}, ${Boolean(body.standalone)})
                  on conflict (device_id) do update set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
                    ua = excluded.ua, standalone = excluded.standalone, updated_at = now()`;
        return json({ ok: true, pushService: new URL(s.endpoint).host });
      }
      case 'send': {
        const [sub] = await sql`select * from spike.push_subscriptions where device_id = ${deviceId}`;
        if (!sub) return json({ error: 'device not subscribed' }, 404);
        const [{ n }] = await sql`select count(*)::int n from spike.push_log where device_id = ${deviceId}`;
        if (n >= 20) return json({ error: 'limit reached' }, 429);
        const delay = Math.min(Math.max(Number(body.delaySec) || 0, 0), 45);
        if (delay > 0) {
          // Trả lời ngay để người dùng khoá máy; gửi chạy nền trong Edge Runtime.
          EdgeRuntime.waitUntil(new Promise((r) => setTimeout(r, delay * 1000)).then(() => doSend(sub, deviceId, delay)));
          return json({ ok: true, scheduledInSec: delay });
        }
        return json(await doSend(sub, deviceId, 0));
      }
      case 'ack': {
        await sql`update spike.push_log set received_at = ${String(body.receivedAt)}::timestamptz, app_state = ${String(body.appState ?? '')}
                  where id = ${String(body.logId)}::uuid and received_at is null`;
        return json({ ok: true });
      }
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

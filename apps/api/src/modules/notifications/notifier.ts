import type { Db, Tx } from '../../db/pool.js';
import { appendSystemMessage, conversationOf } from '../messaging/conversations.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { topics } from '../realtime/publisher.js';
import { facts } from './facts.js';
import { scopeAnchors, systemLine } from './lines.js';
import { applyResolutions } from './resolve.js';
import { audience, COALESCE_WINDOW_MIN, familyOf, itemObject, targetOf } from './rules.js';
import type { Activity, AudienceRow, NotificationClass, Reason, Target } from './types.js';
import { canView } from './visibility.js';

/** Khoá tư vấn: chỉ một bộ notifier xử lý outbox tại một thời điểm → giữ đúng thứ tự seq. */
const LOCK_KEY = 7_340_017;

interface Merged {
  userId: string;
  cls: NotificationClass;
  reasons: Reason[];
  needsAction: boolean;
}

/** Khử trùng trong một sự kiện: một người một dòng, lớp cao nhất, hợp lý do (§8.1). */
function merge(rows: AudienceRow[]): Merged[] {
  const by = new Map<string, Merged>();
  for (const r of rows) {
    const m = by.get(r.userId) ?? { userId: r.userId, cls: 'direct', reasons: [], needsAction: false };
    if (r.cls === 'action_required') m.cls = 'action_required';
    if (!m.reasons.includes(r.reason)) m.reasons.push(r.reason);
    m.needsAction ||= Boolean(r.needsAction);
    by.set(r.userId, m);
  }
  return [...by.values()];
}

/**
 * Xử lý một ActivityEvent (NOTIFICATION_ENGINE §4 bước 1–6). Idempotent (N8): mục đã có cho
 * (người, sự kiện) thì bỏ qua; dòng hệ thống có UNIQUE (hội thoại, sự kiện).
 */
export async function processActivity(tx: Tx, rt: RealtimePublisher, a: Activity) {
  await applyResolutions(tx, rt, a);
  // Thay đổi trên bản nháp không báo ai và không thành dòng hệ thống (F3), kể cả khi notifier chạy sau khi publish.
  if (await isDraftTime(tx, a)) return;

  if (a.verb === 'message.deleted') {
    // Thu hồi thông báo mention/trả lời của tin đã xoá (F9-T5).
    const del = await tx.query<{ id: string; user_id: string }>(
      `delete from app.notifications where object_type = 'message' and object_id = $1 returning id, user_id`,
      [a.object_id],
    );
    for (const n of del.rows) await rt.send(tx, topics.user(n.user_id), 'notification.updated', { type: 'notification', id: n.id, verb: 'notification.removed' });
  }

  const target = targetOf(a);
  if (target) {
    const rows = merge(await audience(a, facts(tx))).filter((r) => r.userId !== a.actor_id); // N1
    for (const r of rows) {
      if (!(await canView(tx, r.userId, target))) continue; // N3
      await upsert(tx, rt, a, target, r);
    }
  }

  await projectSystemLines(tx, rt, a);
}

async function isDraftTime(tx: Tx, a: Activity) {
  const [domain] = a.verb.split('.');
  if (!a.event_id || (domain !== 'event' && domain !== 'position' && domain !== 'assignment' && domain !== 'task')) return false;
  const r = await tx.query<{ draft: boolean }>(
    // So trong SQL: Date của JS cắt micro giây nên so ở ứng dụng sẽ sai với sự kiện cùng giao dịch publish.
    `select (e.published_at is null or x.occurred_at < e.published_at) as draft
       from app.events e, app.activity_events x where e.id = $1 and x.id = $2`,
    [a.event_id, a.id],
  );
  return r.rows[0]?.draft ?? false;
}

async function upsert(tx: Tx, rt: RealtimePublisher, a: Activity, target: Target, r: Merged) {
  const done = await tx.query(
    `select 1 from app.notification_items i join app.notifications n on n.id = i.notification_id where i.activity_event_id = $1 and n.user_id = $2`,
    [a.id, r.userId],
  );
  if (done.rowCount) return;

  const root = a.cause_id ?? a.id;
  const family = familyOf(a.verb);
  const obj = itemObject(a);

  // 1) Cùng nguyên nhân gốc → cùng bản ghi (§8.1).
  let existing = (
    await tx.query<{ id: string }>(`select id from app.notifications where user_id = $1 and root_activity_id = $2 for update`, [r.userId, root])
  ).rows[0];
  // 2) Làm mới bản ghi đang chờ trên cùng Event (§8.2 cơ chế 3).
  if (!existing && family === 'event.change' && r.cls === 'direct') {
    existing = (
      await tx.query<{ id: string }>(
        `select id from app.notifications where user_id = $1 and object_type = $2 and object_id = $3 and action_state = 'pending'
          order by created_at desc limit 1 for update`,
        [r.userId, target.type, target.id],
      )
    ).rows[0];
  }
  // 3) Gộp theo thời gian: cùng family, cùng đối tượng, chưa đọc, trong COALESCE_WINDOW (§8.2 cơ chế 2).
  if (!existing && family) {
    existing = (
      await tx.query<{ id: string }>(
        `select id from app.notifications
          where user_id = $1 and family = $2 and object_type = $3 and object_id = $4 and read_at is null
            and updated_at > (select occurred_at from app.activity_events where id = $5) - make_interval(mins => $6)
          order by updated_at desc limit 1 for update`,
        [r.userId, family, target.type, target.id, a.id, COALESCE_WINDOW_MIN],
      )
    ).rows[0];
  }

  let id: string;
  let verb: 'notification.created' | 'notification.updated';
  if (existing) {
    id = existing.id;
    verb = 'notification.updated';
    await tx.query(
      `update app.notifications
          set class = case when $2 = 'action_required' then 'action_required' else class end,
              action_state = case when $3 then 'pending' when class = 'direct' and $2 = 'direct' then action_state else action_state end,
              action_resolved_at = case when $3 then null else action_resolved_at end,
              reasons = (select array_agg(distinct x) from unnest(reasons || $4::text[]) x),
              read_at = case when $3 then null else read_at end,
              updated_at = now()
        where id = $1`,
      [id, r.cls, r.needsAction, r.reasons],
    );
  } else {
    verb = 'notification.created';
    const ins = await tx.query<{ id: string }>(
      `insert into app.notifications (org_id, user_id, root_activity_id, class, family, object_type, object_id, reasons, action_state)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [a.org_id, r.userId, root, r.cls, family, target.type, target.id, r.reasons, r.needsAction ? 'pending' : 'none'],
    );
    id = ins.rows[0]!.id;
  }
  await tx.query(
    `insert into app.notification_items (notification_id, activity_event_id, verb, object_type, object_id, needs_action)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [id, a.id, a.verb, obj.type, obj.id, r.needsAction],
  );
  await rt.send(tx, topics.user(r.userId), verb, { type: 'notification', id, verb });
}

async function projectSystemLines(tx: Tx, rt: RealtimePublisher, a: Activity) {
  const groupIds = a.event_id
    ? (await tx.query<{ group_id: string }>(`select group_id from app.event_groups where event_id = $1`, [a.event_id])).rows.map((g) => g.group_id)
    : [];
  const anchors = scopeAnchors(a, groupIds);
  if (!anchors.length) return;
  const line = await systemLine(tx, a);
  if (!line) return;
  for (const anchor of anchors) {
    const conv = await conversationOf(tx, anchor.type, anchor.id);
    if (conv) await appendSystemMessage(tx, rt, conv.id, a.id, line);
  }
}

const SELECT = `select id, seq, org_id, verb, actor_type, actor_id, object_type, object_id, event_id, task_id, group_id,
                       conversation_id, cause_id, payload, occurred_at from app.activity_events`;

/**
 * Đọc outbox theo seq, mỗi sự kiện một giao dịch (lỗi một sự kiện không làm mất các sự kiện khác).
 * Trả số sự kiện đã xử lý. Bộ notifier khác đang chạy → trả 0 ngay.
 */
export async function dispatchPending(db: Db, rt: RealtimePublisher, opts: { limit?: number; onError?: (e: unknown, a: Activity) => void } = {}) {
  const client = await db.connect();
  let n = 0;
  try {
    const got = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock($1) as ok`, [LOCK_KEY]);
    if (!got.rows[0]!.ok) return 0;
    try {
      for (;;) {
        if (opts.limit !== undefined && n >= opts.limit) break;
        await client.query('begin');
        const r = await client.query<Activity>(`${SELECT} where dispatched_at is null order by seq limit 1 for update`);
        const a = r.rows[0];
        if (!a) {
          await client.query('commit');
          break;
        }
        try {
          await client.query('savepoint s');
          await processActivity(client, rt, a);
        } catch (e) {
          // Sự kiện lỗi được đánh dấu để không chặn hàng đợi; ghi log để vận hành xử lý lại.
          await client.query('rollback to savepoint s');
          opts.onError?.(e, a);
        }
        await client.query(`update app.activity_events set dispatched_at = now() where id = $1`, [a.id]);
        await client.query('commit');
        n++;
      }
    } finally {
      await client.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return n;
}

/** Chạy nền: gọi ngay sau mỗi lệnh ghi (kick) và quét định kỳ phòng khi lỡ. */
export class NotifierRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  constructor(
    private readonly db: Db,
    private readonly rt: RealtimePublisher,
    private readonly log: { error: (o: unknown, msg: string) => void },
  ) {}

  start(intervalMs = 5000) {
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.kick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void dispatchPending(this.db, this.rt, { onError: (e, a) => this.log.error({ err: e, activity: a.id, verb: a.verb }, 'notifier: lỗi xử lý sự kiện') })
      .catch((e) => this.log.error({ err: e }, 'notifier: lỗi'))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }
}

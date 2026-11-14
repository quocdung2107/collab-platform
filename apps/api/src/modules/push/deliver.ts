import type { Db, Queryable, Tx } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { viewConversation } from '../messaging/conversations.js';
import { renderNotification } from '../notifications/inbox.js';
import { allows, loadPrefs } from './prefs.js';
import { pushNow, type PushMessage, type PushSender, type PushTarget } from './sender.js';

/** §11: thử lại sau 1, 5, 30 phút; tối đa 3 lần thử lại (tổng 4 lần gửi), sau đó failed. */
export const RETRY_SCHEDULE_MS = [60_000, 5 * 60_000, 30 * 60_000];
export const RETRY_MAX = RETRY_SCHEDULE_MS.length;

interface DRow {
  id: string;
  user_id: string;
  subscription_id: string;
  kind: 'notification' | 'chat';
  notification_id: string | null;
  conversation_id: string | null;
  last_seq: string | null;
  quiet_deferred: boolean;
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  disabled: boolean;
}
const SELECT = `select d.id, d.user_id, d.subscription_id, d.kind, d.notification_id, d.conversation_id, d.last_seq, d.quiet_deferred, d.attempts,
                       s.endpoint, s.p256dh, s.auth, s.disabled_at is not null as disabled
                  from app.notification_deliveries d join app.push_subscriptions s on s.id = d.subscription_id`;

type Plan = { skip: string } | { msg: PushMessage; cls: 'action_required' | 'direct' | 'chat' };

const routeHash = (l: { route: string; id: string } | null) => (l ? `#${l.route}=${l.id}` : '#inbox');

/** Kiểm tra ngay trước khi gửi (§8.6): đã đọc / đã xong / mất quyền xem / tắt công tắc → skipped. Dựng nội dung tại đây. */
async function plan(db: Queryable, d: DRow): Promise<Plan> {
  const prefs = await loadPrefs(db, d.user_id);
  if (d.kind === 'notification') {
    const n = (
      await db.query<{ class: 'action_required' | 'direct'; read_at: Date | null; action_state: string }>(
        `select class, read_at, action_state from app.notifications where id = $1`,
        [d.notification_id],
      )
    ).rows[0];
    if (!n) return { skip: 'removed' };
    if (n.class === 'action_required' ? n.action_state !== 'pending' : n.read_at) return { skip: n.read_at ? 'read' : 'resolved' };
    if (!allows(prefs, n.class)) return { skip: 'preference' };
    const dto = await renderNotification(db, d.user_id, d.notification_id!);
    if (!dto?.available) return { skip: 'no_access' };
    return {
      cls: n.class,
      msg: {
        title: `${n.class === 'action_required' ? 'Cần bạn · ' : ''}${dto.title ?? 'Thông báo'}`.slice(0, 120),
        body: (dto.lines.at(-1) ?? dto.subtitle ?? '').slice(0, 200),
        url: routeHash(dto.link),
        tag: `n:${d.notification_id}`,
      },
    };
  }
  if (!allows(prefs, 'chat')) return { skip: 'preference' };
  try {
    await viewConversation(db, d.user_id, d.conversation_id!);
  } catch (e) {
    if (e instanceof AppError && (e.code === 'not_found' || e.code === 'forbidden')) return { skip: 'no_access' };
    throw e;
  }
  const mode = (await db.query<{ mode: string }>(`select mode from app.subscriptions where user_id = $1 and target_type = 'conversation' and target_id = $2`, [d.user_id, d.conversation_id]))
    .rows[0]?.mode;
  if (mode === 'mute' || mode === 'mentions') return { skip: 'preference' };
  const c = (
    await db.query<{ unread: number; last_sender: string | null; name: string | null; anchor_type: string; anchor_id: string }>(
      `select (select count(*)::int from app.messages m
                where m.conversation_id = c.id and m.kind = 'user' and m.deleted_at is null and m.sender_id <> $2
                  and m.seq > coalesce(s.last_read_seq, 0) and m.seq <= $3) as unread,
              (select u.display_name from app.messages m join app.users u on u.id = m.sender_id
                where m.conversation_id = c.id and m.kind = 'user' and m.deleted_at is null and m.sender_id <> $2 and m.seq <= $3
                order by m.seq desc limit 1) as last_sender,
              coalesce(g.name, e.title, k.title) as name, c.anchor_type, c.anchor_id
         from app.conversations c
         left join app.conversation_states s on s.conversation_id = c.id and s.user_id = $2
         left join app.groups g on c.anchor_type = 'group' and g.id = c.anchor_id
         left join app.events e on c.anchor_type = 'event' and e.id = c.anchor_id
         left join app.tasks k on c.anchor_type = 'task' and k.id = c.anchor_id
        where c.id = $1`,
      [d.conversation_id, d.user_id, d.last_seq],
    )
  ).rows[0]!;
  // Đã đọc tới tin cuối (đang mở hội thoại) → không đẩy (§9).
  if (c.unread === 0) return { skip: 'read' };
  return {
    cls: 'chat',
    msg: {
      title: (c.name ?? 'Trò chuyện').slice(0, 120),
      body: c.unread === 1 ? `Tin mới từ ${c.last_sender ?? 'một thành viên'}` : `${c.unread} tin mới · mới nhất từ ${c.last_sender ?? 'một thành viên'}`,
      url: `#${c.anchor_type}=${c.anchor_id}`,
      tag: `c:${d.conversation_id}`,
    },
  };
}

async function mark(tx: Tx, ids: string[], status: 'sent' | 'skipped' | 'cancelled' | 'failed', error: string | null) {
  await tx.query(
    `update app.notification_deliveries set status = $2, last_error = $3, updated_at = now(),
            sent_at = case when $2 = 'sent' then $4::timestamptz else sent_at end,
            attempts = attempts + case when $2 in ('sent', 'failed') then 1 else 0 end
      where id = any($1::uuid[])`,
    [ids, status, error, pushNow()],
  );
}

/** Gửi một lần cho nhóm delivery (một hoặc tổng hợp); xử lý kết quả theo §8.6. */
async function sendAndRecord(tx: Tx, sender: PushSender, rows: DRow[], msg: PushMessage, chatSeq?: { conversationId: string; userId: string; seq: string }) {
  const t: PushTarget = { endpoint: rows[0]!.endpoint, p256dh: rows[0]!.p256dh, auth: rows[0]!.auth };
  const r = await sender.send(t, msg);
  const ids = rows.map((x) => x.id);
  if (r.ok) {
    await mark(tx, ids, 'sent', null);
    if (chatSeq) {
      await tx.query(`update app.conversation_states set last_pushed_seq = greatest(last_pushed_seq, $3) where conversation_id = $1 and user_id = $2`, [
        chatSeq.conversationId,
        chatSeq.userId,
        chatSeq.seq,
      ]);
    }
    return;
  }
  if (r.permanent) {
    // Subscription hỏng: delivery failed, vô hiệu hoá subscription, huỷ các delivery khác đang chờ trên nó.
    await mark(tx, ids, 'failed', r.error);
    await tx.query(`update app.push_subscriptions set disabled_at = now(), disabled_reason = 'gone' where id = $1 and disabled_at is null`, [rows[0]!.subscription_id]);
    await tx.query(
      `update app.notification_deliveries set status = 'cancelled', last_error = 'subscription_gone', updated_at = now()
        where subscription_id = $1 and status = 'scheduled'`,
      [rows[0]!.subscription_id],
    );
    return;
  }
  const attempts = rows[0]!.attempts + 1;
  if (attempts > RETRY_MAX) {
    await mark(tx, ids, 'failed', r.error);
    return;
  }
  await tx.query(
    `update app.notification_deliveries set attempts = attempts + 1, last_error = $2, not_before = $3, updated_at = now() where id = any($1::uuid[])`,
    [ids, r.error, new Date(pushNow().getTime() + RETRY_SCHEDULE_MS[attempts - 1]!)],
  );
}

/** Tổng hợp sau giờ yên lặng (§8.3): mọi delivery bị hoãn của một thiết bị → một thông báo đẩy. */
async function summary(tx: Tx, sender: PushSender, rows: DRow[]) {
  const live: DRow[] = [];
  let action = 0;
  let updates = 0;
  let chats = 0;
  for (const d of rows) {
    const p = await plan(tx, d);
    if ('skip' in p) {
      await mark(tx, [d.id], 'skipped', p.skip);
      continue;
    }
    live.push(d);
    if (p.cls === 'action_required') action++;
    else if (p.cls === 'direct') updates++;
    else chats++;
  }
  if (!live.length) return;
  const parts = [action && `${action} việc cần bạn`, updates && `${updates} cập nhật`, chats && `${chats} hội thoại có tin mới`].filter(Boolean);
  await sendAndRecord(tx, sender, live, { title: 'Trong lúc bạn nghỉ', body: parts.join(', '), url: action ? '#inbox' : '#', tag: 'quiet-summary' });
}

/**
 * Gửi các delivery đến hạn. Mỗi lần một giao dịch; SKIP LOCKED để nhiều tiến trình không gửi trùng.
 * Trả số lượt gửi/bỏ qua đã xử lý.
 */
export async function dispatchDeliveries(db: Db, sender: PushSender, opts: { limit?: number } = {}) {
  let n = 0;
  for (;;) {
    if (opts.limit !== undefined && n >= opts.limit) break;
    const client = await db.connect();
    try {
      await client.query('begin');
      const now = pushNow();
      const first = (await client.query<DRow>(`${SELECT} where d.status = 'scheduled' and d.not_before <= $1 order by d.not_before limit 1 for update of d skip locked`, [now])).rows[0];
      if (!first) {
        await client.query('commit');
        break;
      }
      if (first.disabled) await mark(client, [first.id], 'cancelled', 'subscription_disabled');
      else if (first.quiet_deferred) {
        const group = (
          await client.query<DRow>(
            `${SELECT} where d.subscription_id = $1 and d.status = 'scheduled' and d.quiet_deferred and d.not_before <= $2 order by d.created_at for update of d skip locked`,
            [first.subscription_id, now],
          )
        ).rows;
        await summary(client, sender, group.length ? group : [first]);
      } else {
        const p = await plan(client, first);
        if ('skip' in p) await mark(client, [first.id], 'skipped', p.skip);
        else
          await sendAndRecord(
            client,
            sender,
            [first],
            p.msg,
            first.kind === 'chat' ? { conversationId: first.conversation_id!, userId: first.user_id, seq: first.last_seq! } : undefined,
          );
      }
      await client.query('commit');
      n++;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  return n;
}

export class DeliveryRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private readonly db: Db,
    private readonly sender: PushSender,
    private readonly log: { error: (o: unknown, msg: string) => void },
  ) {}
  start(intervalMs = 10_000) {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  private tick() {
    if (this.running) return;
    this.running = true;
    void dispatchDeliveries(this.db, this.sender, { limit: 200 })
      .catch((e) => this.log.error({ err: e }, 'push: lỗi gửi'))
      .finally(() => (this.running = false));
  }
}

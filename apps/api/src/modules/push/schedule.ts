import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { viewConversation } from '../messaging/conversations.js';
import type { Activity, NotificationClass } from '../notifications/types.js';
import { allows, loadPrefs, userTimezone } from './prefs.js';
import { bypassesQuiet, quietUntil } from './quiet.js';
import { pushNow, pushSender } from './sender.js';

/** Tham số NOTIFICATION_ENGINE §11. DEBOUNCE_CHAT không có trong đặc tả: chọn 15 giây (IN-44). */
export const DEBOUNCE_MS = { action_required: 30_000, direct: 120_000, chat: 15_000 } as const;

async function activeSubs(db: Queryable, userId: string) {
  return (await db.query<{ id: string }>(`select id from app.push_subscriptions where user_id = $1 and disabled_at is null`, [userId])).rows.map((r) => r.id);
}

/** Thời điểm sớm nhất được gửi: debounce, rồi đẩy tới quiet_end nếu đang giờ yên lặng (trừ ngoại lệ OD-03). */
async function when(db: Queryable, userId: string, orgId: string, cls: NotificationClass | 'chat', eventStart: Date | null) {
  const prefs = await loadPrefs(db, userId);
  if (!allows(prefs, cls)) return null;
  const now = pushNow();
  const base = new Date(now.getTime() + DEBOUNCE_MS[cls]);
  if (!prefs.quietHoursEnabled) return { notBefore: base, deferred: false };
  const end = quietUntil(base, await userTimezone(db, userId, orgId), prefs.quietStart, prefs.quietEnd);
  if (!end || (cls !== 'chat' && bypassesQuiet(cls, eventStart, end))) return { notBefore: base, deferred: false };
  return { notBefore: end, deferred: true };
}

/** Hội thoại người dùng đặt mute → mention/trả lời vẫn vào hộp thông báo nhưng không đẩy (§9). */
async function conversationMode(db: Queryable, userId: string, conversationId: string) {
  const r = await db.query<{ mode: string }>(`select mode from app.subscriptions where user_id = $1 and target_type = 'conversation' and target_id = $2`, [
    userId,
    conversationId,
  ]);
  return r.rows[0]?.mode ?? null;
}

/**
 * Gọi khi notifier tạo/cập nhật một bản ghi (§8.6): mỗi thiết bị một delivery. Bản ghi được gộp mà delivery
 * đang chờ → giữ lịch cũ (debounce cho gộp kịp); delivery đã gửi → lên lịch lại (thông báo được cập nhật).
 */
export async function scheduleNotificationPush(tx: Queryable, a: Activity, n: { id: string; userId: string; cls: NotificationClass }) {
  if (!pushSender()) return;
  const subs = await activeSubs(tx, n.userId);
  if (!subs.length) return;
  if ((a.verb === 'message.created' || a.verb === 'message.edited') && a.conversation_id && (await conversationMode(tx, n.userId, a.conversation_id)) === 'mute') return;
  const start = a.event_id
    ? ((await tx.query<{ starts_at: Date }>(`select starts_at from app.events where id = $1`, [a.event_id])).rows[0]?.starts_at ?? null)
    : null;
  const w = await when(tx, n.userId, a.org_id, n.cls, start);
  if (!w) return;
  for (const s of subs) {
    await tx.query(
      `insert into app.notification_deliveries as d (user_id, subscription_id, kind, notification_id, not_before, quiet_deferred)
       values ($1, $2, 'notification', $3, $4, $5)
       on conflict (notification_id, subscription_id) where kind = 'notification' do update set
         not_before = case when d.status = 'scheduled' then least(d.not_before, excluded.not_before) else excluded.not_before end,
         quiet_deferred = case when d.status = 'scheduled' and d.not_before <= excluded.not_before then d.quiet_deferred else excluded.quiet_deferred end,
         attempts = case when d.status = 'scheduled' then d.attempts else 0 end,
         status = 'scheduled', last_error = null, updated_at = now()`,
      [n.userId, s, n.id, w.notBefore, w.deferred],
    );
  }
}

async function canViewConversation(db: Queryable, userId: string, id: string) {
  try {
    await viewConversation(db, userId, id);
    return true;
  } catch (e) {
    if (e instanceof AppError && (e.code === 'not_found' || e.code === 'forbidden')) return false;
    throw e;
  }
}

/**
 * Người nhận chat ở chế độ all (§9): mặc định Group = thành viên; Event/Task = người có lý do trách nhiệm;
 * Subscription của hội thoại ghi đè. Không gồm người gửi và người được mention/trả lời (họ nhận qua bản ghi).
 */
async function chatAudience(db: Queryable, conversationId: string) {
  const r = await db.query<{ id: string }>(
    `with c as (select anchor_type, anchor_id from app.conversations where id = $1),
     d as (
       select gm.user_id as id from c join app.group_members gm on c.anchor_type = 'group' and gm.group_id = c.anchor_id
       union select eo.user_id from c join app.event_owners eo on c.anchor_type = 'event' and eo.event_id = c.anchor_id
       union select a.user_id from c join app.assignments a on c.anchor_type = 'event' and a.event_id = c.anchor_id and a.status in ('requested', 'accepted', 'reconfirm')
       union select t.owner_id from c join app.tasks t on c.anchor_type = 'task' and t.id = c.anchor_id where t.owner_id is not null
       union select t.assigned_by from c join app.tasks t on c.anchor_type = 'task' and t.id = c.anchor_id where t.assigned_by is not null
       union select tc.user_id from c join app.task_collaborators tc on c.anchor_type = 'task' and tc.task_id = c.anchor_id
     )
     select id from d where id not in (select user_id from app.subscriptions where target_type = 'conversation' and target_id = $1 and mode <> 'all')
     union select user_id from app.subscriptions where target_type = 'conversation' and target_id = $1 and mode = 'all'`,
    [conversationId],
  );
  return r.rows.map((x) => x.id);
}

/** Tin thường (không phải dòng hệ thống — dòng hệ thống không có message.created) → delivery chat thu gọn theo hội thoại. */
export async function scheduleChatPush(tx: Queryable, a: Activity) {
  if (!pushSender() || a.verb !== 'message.created' || !a.conversation_id) return;
  const p = a.payload;
  const seq = Number(p.seq);
  const skip = new Set<string>([a.actor_id ?? '', ...((p.mention_ids as string[]) ?? []), ...(p.reply_to_sender_id ? [p.reply_to_sender_id as string] : [])]);
  for (const userId of await chatAudience(tx, a.conversation_id)) {
    if (skip.has(userId)) continue;
    const subs = await activeSubs(tx, userId);
    if (!subs.length || !(await canViewConversation(tx, userId, a.conversation_id))) continue;
    const w = await when(tx, userId, a.org_id, 'chat', null);
    if (!w) continue;
    for (const s of subs) {
      // Chỉ tin mới hơn mới làm delivery quay lại scheduled → xử lý lại cùng sự kiện không đẩy thêm (N8).
      await tx.query(
        `insert into app.notification_deliveries as d (user_id, subscription_id, kind, conversation_id, last_seq, not_before, quiet_deferred)
         values ($1, $2, 'chat', $3, $4, $5, $6)
         on conflict (conversation_id, subscription_id) where kind = 'chat' do update set
           last_seq = excluded.last_seq,
           not_before = case when d.status = 'scheduled' then d.not_before else excluded.not_before end,
           quiet_deferred = case when d.status = 'scheduled' then d.quiet_deferred else excluded.quiet_deferred end,
           attempts = case when d.status = 'scheduled' then d.attempts else 0 end,
           status = 'scheduled', last_error = null, updated_at = now()
         where excluded.last_seq > d.last_seq`,
        [userId, s, a.conversation_id, seq, w.notBefore, w.deferred],
      );
    }
  }
}

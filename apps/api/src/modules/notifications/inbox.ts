import type { NotificationDto, NotificationPageDto } from '@collab/shared';
import type { Db, Queryable } from '../../db/pool.js';
import { notFound } from '../../http/validate.js';
import { CANCEL_REASON, lookup, when } from './lookup.js';
import type { Target } from './types.js';
import { canView } from './visibility.js';

interface NRow {
  id: string;
  org_id: string;
  class: 'action_required' | 'direct';
  action_state: 'none' | 'pending' | 'done' | 'superseded';
  object_type: Target['type'];
  object_id: string;
  reasons: string[];
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface IRow {
  notification_id: string;
  verb: string;
  actor_id: string | null;
  payload: Record<string, any>;
  needs_action: boolean;
  resolved_at: Date | null;
  object_type: string;
  object_id: string;
  occurred_at: Date;
}

/**
 * Hộp thông báo (F11). Câu tóm tắt dựng khi xem từ trạng thái hiện tại (NOTIFICATION_ENGINE §8.2):
 * bản ghi đang chờ tự hiển thị giờ/địa điểm mới. Mất quyền xem đối tượng → "Nội dung không còn khả dụng" (F11-T11).
 */
export async function listNotifications(db: Queryable, userId: string, q: { before?: string; limit: number; pendingOnly?: boolean }): Promise<NotificationPageDto> {
  const r = await db.query<NRow>(
    `select id, org_id, class, action_state, object_type, object_id, reasons, read_at, created_at, updated_at
       from app.notifications
      where user_id = $1 and ($2::timestamptz is null or updated_at < $2) and (not $4 or action_state = 'pending')
      order by updated_at desc limit $3`,
    [userId, q.before ?? null, q.limit, Boolean(q.pendingOnly)],
  );
  const items = await render(db, userId, r.rows);
  const counts = await notificationCounts(db, userId);
  return { items, ...counts, nextBefore: r.rows.length === q.limit ? r.rows.at(-1)!.updated_at.toISOString() : null };
}

/** "Có gì mới" của My Workspace: lớp direct chưa đọc, mới nhất trước (UX §4.1). */
export async function unreadDirect(db: Queryable, userId: string, limit: number): Promise<NotificationDto[]> {
  const r = await db.query<NRow>(
    `select id, org_id, class, action_state, object_type, object_id, reasons, read_at, created_at, updated_at
       from app.notifications where user_id = $1 and class = 'direct' and read_at is null order by updated_at desc limit $2`,
    [userId, limit],
  );
  return (await render(db, userId, r.rows)).filter((n) => n.available);
}

export async function notificationCounts(db: Queryable, userId: string) {
  const c = await db.query<{ unread: number; pending: number }>(
    `select count(*) filter (where read_at is null)::int as unread, count(*) filter (where action_state = 'pending')::int as pending
       from app.notifications where user_id = $1`,
    [userId],
  );
  return { unreadCount: c.rows[0]!.unread, pendingCount: c.rows[0]!.pending };
}

/** Đặt đã đọc. "Cần bạn" vẫn pending tới khi hành động xảy ra (§8.7). */
export async function markNotificationRead(db: Db, userId: string, id: string) {
  const r = await db.query(`update app.notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2`, [id, userId]);
  if (!r.rowCount) throw notFound();
  return notificationCounts(db, userId);
}

/** "Đánh dấu tất cả đã đọc" chỉ áp cho lớp direct (F11-T13). */
export async function markAllRead(db: Db, userId: string) {
  await db.query(`update app.notifications set read_at = now() where user_id = $1 and class = 'direct' and read_at is null`, [userId]);
  return notificationCounts(db, userId);
}

/** Mở đối tượng đích → đọc mọi bản ghi của người dùng trỏ tới nó. */
export async function markTargetRead(db: Db, userId: string, target: { type: string; id: string }) {
  await db.query(`update app.notifications set read_at = now() where user_id = $1 and object_type = $2 and object_id = $3 and read_at is null`, [
    userId,
    target.type,
    target.id,
  ]);
  return notificationCounts(db, userId);
}

async function render(db: Queryable, userId: string, rows: NRow[]): Promise<NotificationDto[]> {
  if (!rows.length) return [];
  const items = await db.query<IRow>(
    `select i.notification_id, i.verb, a.actor_id, a.payload, i.needs_action, i.resolved_at, i.object_type, i.object_id, a.occurred_at
       from app.notification_items i join app.activity_events a on a.id = i.activity_event_id
      where i.notification_id = any($1::uuid[]) order by a.seq`,
    [rows.map((r) => r.id)],
  );
  const L = lookup(db);
  const out: NotificationDto[] = [];
  for (const n of rows) {
    const mine = items.rows.filter((i) => i.notification_id === n.id);
    const target: Target = { type: n.object_type, id: n.object_id };
    const base = {
      id: n.id,
      class: n.class,
      actionState: n.action_state,
      reasons: n.reasons,
      readAt: n.read_at?.toISOString() ?? null,
      createdAt: n.created_at.toISOString(),
      updatedAt: n.updated_at.toISOString(),
      target,
    };
    if (!(await canView(db, userId, target))) {
      out.push({ ...base, available: false, title: null, subtitle: null, lines: ['Nội dung không còn khả dụng'], link: null, pendingAssignments: [] });
      continue;
    }
    const tz = await L.orgTimezone(n.org_id);
    const head = await heading(db, target, tz);
    const lines: string[] = [];
    for (const i of mine) {
      const line = await describe(db, L, userId, i, tz, head.startsAt);
      if (line && !lines.includes(line)) lines.push(line);
    }
    out.push({
      ...base,
      available: true,
      title: head.title,
      subtitle: head.subtitle,
      lines,
      link: head.link,
      pendingAssignments: await pendingAssignments(
        db,
        userId,
        mine.filter((i) => i.needs_action && !i.resolved_at && i.object_type === 'assignment').map((i) => i.object_id),
      ),
    });
  }
  return out;
}

/** Trạng thái hiện tại của Assignment còn chờ chính người dùng trả lời (dữ liệu nghiệp vụ thắng, §8.7). */
async function pendingAssignments(db: Queryable, userId: string, ids: string[]) {
  if (!ids.length) return [];
  const r = await db.query<{ id: string; status: 'requested' | 'reconfirm' }>(
    `select id, status from app.assignments where id = any($1::uuid[]) and user_id = $2 and status in ('requested', 'reconfirm')`,
    [ids, userId],
  );
  return r.rows;
}

async function heading(db: Queryable, t: Target, tz: string): Promise<{ title: string; subtitle: string | null; link: NotificationDto['link']; startsAt: Date | null }> {
  switch (t.type) {
    case 'event': {
      const e = (await db.query<{ title: string; starts_at: Date; location: string | null; status: string }>(
        `select title, starts_at, location, status from app.events where id = $1`,
        [t.id],
      )).rows[0]!;
      const sub = [when(e.starts_at, tz), e.location, e.status === 'cancelled' ? 'đã huỷ' : null].filter(Boolean).join(' · ');
      return { title: e.title, subtitle: sub, link: { route: 'event', id: t.id }, startsAt: e.starts_at };
    }
    case 'group': {
      const g = (await db.query<{ name: string }>(`select name from app.groups where id = $1`, [t.id])).rows[0]!;
      return { title: g.name, subtitle: 'Nhóm', link: { route: 'group', id: t.id }, startsAt: null };
    }
    case 'organization': {
      const o = (await db.query<{ name: string }>(`select name from app.organizations where id = $1`, [t.id])).rows[0]!;
      return { title: o.name, subtitle: 'Tổ chức', link: { route: 'org', id: t.id }, startsAt: null };
    }
    case 'message': {
      const c = (await db.query<{ anchor_type: string; anchor_id: string; name: string | null }>(
        `select c.anchor_type, c.anchor_id, coalesce(g.name, e.title) as name
           from app.messages m join app.conversations c on c.id = m.conversation_id
           left join app.groups g on g.id = c.anchor_id and c.anchor_type = 'group'
           left join app.events e on e.id = c.anchor_id and c.anchor_type = 'event'
          where m.id = $1`,
        [t.id],
      )).rows[0]!;
      const route = c.anchor_type === 'group' ? 'group' : c.anchor_type === 'event' ? 'event' : 'task';
      return { title: c.name ?? 'Trò chuyện', subtitle: 'Trò chuyện', link: { route, id: c.anchor_id }, startsAt: null };
    }
    case 'task': {
      const k = (await db.query<{ title: string; due_at: Date | null }>(`select title, due_at from app.tasks where id = $1`, [t.id])).rows[0]!;
      return { title: k.title, subtitle: k.due_at ? `Hạn ${when(k.due_at, tz)}` : 'Việc', link: { route: 'task', id: t.id }, startsAt: null };
    }
  }
}

async function describe(db: Queryable, L: ReturnType<typeof lookup>, me: string, i: IRow, tz: string, startsAt: Date | null): Promise<string | null> {
  const p = i.payload;
  const actor = await L.userName(i.actor_id);
  const pos = () => L.positionName(p.position_id);
  switch (i.verb) {
    case 'assignment.requested': {
      const r = (await db.query<{ report_offset_min: number }>(`select report_offset_min from app.positions where id = $1`, [p.position_id])).rows[0];
      const report = startsAt && r ? ` · có mặt ${when(new Date(startsAt.getTime() + r.report_offset_min * 60_000), tz)}` : '';
      return `Bạn được xếp vào ${await pos()}${report}`;
    }
    case 'assignment.reconfirm_requested':
      return `Buổi đổi giờ: xác nhận lại ${await pos()}`;
    case 'assignment.accepted':
      return `${actor} đã nhận thay bạn ${await pos()}`;
    case 'assignment.declined':
      return p.assignee_id === me ? `${actor} đã từ chối thay bạn ${await pos()}` : `${await L.userName(p.assignee_id)} từ chối ${await pos()}: cần người thay`;
    case 'assignment.cancelled':
      return p.cancel_reason === 'member_left'
        ? `${await L.userName(p.assignee_id)} đã rời tổ chức: ${await pos()} cần người thay`
        : `Bạn không còn ở ${await pos()} (${CANCEL_REASON[p.cancel_reason] ?? p.cancel_reason})`;
    case 'event.published':
      return `${actor} đã công bố buổi`;
    case 'event.updated':
      return `${actor} đã cập nhật thông tin buổi`;
    case 'event.rescheduled':
      return `Dời giờ: ${when(p.before?.starts_at, tz)} → ${when(p.after?.starts_at, tz)}`;
    case 'event.relocated':
      return `Đổi địa điểm: ${p.before ?? '—'} → ${p.after ?? '—'}`;
    case 'event.cancelled':
      return `${actor} đã huỷ buổi`;
    case 'event.owner_changed':
      return (p.added as string[] | undefined)?.includes(me) ? `${actor} đã thêm bạn làm người phụ trách` : `${actor} đã bỏ bạn khỏi người phụ trách`;
    case 'group.member_added':
      return `${actor} đã thêm bạn vào nhóm`;
    case 'group.member_removed':
      return `${actor} đã gỡ bạn khỏi nhóm`;
    case 'group.member_role_changed':
      return `Bạn giờ là ${p.after === 'leader' ? 'trưởng nhóm' : 'thành viên'} của nhóm`;
    case 'member.role_changed':
      return `Vai trò của bạn trong tổ chức: ${ROLE[p.after] ?? p.after}`;
    case 'message.created':
      return (p.mention_ids as string[] | undefined)?.includes(me) ? `${actor} đã nhắc tới bạn` : `${actor} đã trả lời tin của bạn`;
    case 'message.edited':
      return `${actor} đã nhắc tới bạn`;
    case 'task.assigned':
      if (!p.to_owner_id) return 'Việc chưa có người phụ trách: cần giao lại';
      return p.to_owner_id === me ? `${actor} giao việc cho bạn` : `Bạn không còn phụ trách việc này`;
    case 'task.accepted':
      return `${actor} đã nhận việc`;
    case 'task.declined':
      return `${actor} đã từ chối việc: cần giao lại`;
    case 'task.completed':
      return `${actor} đã hoàn thành việc`;
    case 'task.reopened':
      return `${actor} đã mở lại việc`;
    case 'task.cancelled':
      return `${actor} đã huỷ việc`;
    case 'task.due_changed':
      return `Hạn đổi: ${when(p.before, tz) || 'không hạn'} → ${when(p.after, tz) || 'không hạn'}`;
    case 'task.status_changed':
      return `${actor} đổi tiến độ việc`;
    case 'task.updated':
      return `${actor} đã sửa việc`;
    case 'task.flag_changed':
      return `${actor} bật cờ ${p.flag === 'needs_help' ? '"cần giúp"' : '"bị chặn"'}`;
    case 'task.collaborator_added':
      return `${actor} đã thêm bạn cùng làm việc này`;
    case 'task.collaborator_removed':
      return `${actor} đã bỏ bạn khỏi người cùng làm`;
    case 'attachment.added':
      return `${actor} đã thêm tệp`;
    case 'attachment.removed':
      return `${actor} đã gỡ tệp`;
    default:
      return null;
  }
}

const ROLE: Record<string, string> = { owner: 'chủ sở hữu', admin: 'quản trị', member: 'thành viên' };

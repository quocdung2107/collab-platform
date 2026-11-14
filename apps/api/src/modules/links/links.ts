import type { ObjectCardDto, RelatedDto, TaskSourceDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, managesTask } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { viewGroup } from '../groups/groups.js';
import { viewMessage } from '../messaging/conversations.js';
import { viewEvent } from '../scheduling/access.js';
import type { ActivityInput } from '../activity/record.js';
import { viewTask } from '../tasks/access.js';

/**
 * Context Engine (CONTEXT_ENGINE §2–§5, F10): Link có hướng, truy xuất hai chiều, không mang quyền.
 * Xem Link = xem được cả hai đầu; một đầu → thẻ "Nội dung bị giới hạn" hoặc chỉ được đếm.
 */

type ActCtx = NonNullable<ActivityInput['context']>;

export type WorkType = 'event' | 'task' | 'group';
export interface Ref {
  type: WorkType;
  id: string;
}

interface LinkRow {
  id: string;
  org_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: 'references' | 'created_from' | 'resolution' | 'blocks';
  origin: 'system' | 'manual';
  created_by: string | null;
}
const LINK_COLS = 'id, org_id, from_type, from_id, to_type, to_id, relation, origin, created_by';

/** Đường dẫn nội bộ trong nội dung tin: …#event=<uuid>, #task=<uuid>, #group=<uuid> (origin = system). */
const REF_RE = /#(event|task|group)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
export function detectRefs(body: string): Ref[] {
  return [...body.matchAll(REF_RE)].map((m) => ({ type: m[1]!.toLowerCase() as WorkType, id: m[2]!.toLowerCase() }));
}

/** Xem được đối tượng công việc + tiêu đề cho thẻ; không xem được / khác tổ chức → null. */
async function peek(db: Queryable, userId: string, r: Ref, orgId?: string): Promise<{ orgId: string; title: string; subtitle: string | null } | null> {
  try {
    if (r.type === 'event') {
      const v = await viewEvent(db, userId, r.id);
      if (orgId && v.row.org_id !== orgId) return null;
      return { orgId: v.row.org_id, title: v.row.title, subtitle: v.row.status === 'cancelled' ? 'Buổi đã huỷ' : 'Buổi' };
    }
    if (r.type === 'task') {
      const v = await viewTask(db, userId, r.id);
      if (orgId && v.row.org_id !== orgId) return null;
      return { orgId: v.row.org_id, title: v.row.title, subtitle: v.row.status === 'done' ? 'Việc · xong' : v.row.status === 'cancelled' ? 'Việc · đã huỷ' : 'Việc' };
    }
    const g = await viewGroup(db, userId, r.id);
    if (orgId && g.group.org_id !== orgId) return null;
    return { orgId: g.group.org_id, title: g.group.name, subtitle: 'Nhóm' };
  } catch (e) {
    if (e instanceof AppError && (e.code === 'not_found' || e.code === 'forbidden')) return null;
    throw e;
  }
}

async function insertLink(
  ctx: CommandCtx,
  l: { orgId: string; from: { type: string; id: string }; to: { type: string; id: string }; relation: LinkRow['relation']; origin: LinkRow['origin'] },
  context: ActCtx,
  causeId?: string,
) {
  const r = await ctx.tx.query<{ id: string }>(
    `insert into app.links (org_id, from_type, from_id, to_type, to_id, relation, origin, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (from_type, from_id, to_type, to_id, relation) where deleted_at is null do nothing returning id`,
    [l.orgId, l.from.type, l.from.id, l.to.type, l.to.id, l.relation, l.origin, ctx.user.id],
  );
  if (!r.rows[0]) return null; // đã có Link đang hiệu lực (idempotent, F10-T6)
  await emit(ctx, {
    orgId: l.orgId,
    verb: 'context.linked',
    object: { type: 'link', id: r.rows[0].id },
    context,
    causeId,
    payload: { link_id: r.rows[0].id, from: l.from, to: l.to, relation: l.relation, origin: l.origin },
  });
  return r.rows[0].id;
}

async function softDelete(ctx: CommandCtx, rows: LinkRow[], context: ActCtx, causeId?: string) {
  for (const l of rows) {
    await ctx.tx.query(`update app.links set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null`, [l.id, ctx.user.id]);
    await emit(ctx, {
      orgId: l.org_id,
      verb: 'context.unlinked',
      object: { type: 'link', id: l.id },
      context,
      causeId,
      payload: { link_id: l.id, from: { type: l.from_type, id: l.from_id }, to: { type: l.to_type, id: l.to_id }, relation: l.relation },
    });
  }
}

/**
 * Đồng bộ Link `references` của một tin với tập thẻ mới (gửi: tạo; sửa: thêm/bớt, F10-T7).
 * Thẻ chèn chủ động mà người gửi không xem được → not_found (F10 Lỗi). Đường dẫn nhận diện được nhưng
 * không xem được / khác tổ chức thì bỏ qua (không lộ sự tồn tại).
 */
export async function syncMessageRefs(
  ctx: CommandCtx,
  m: { orgId: string; messageId: string; context: ActCtx; causeId: string },
  explicit: Ref[],
  body: string,
) {
  const want = new Map<string, Ref & { origin: 'manual' | 'system' }>();
  for (const r of explicit) {
    if (!(await peek(ctx.tx, ctx.user.id, r, m.orgId))) throw notFound();
    want.set(`${r.type}:${r.id}`, { ...r, origin: 'manual' });
  }
  for (const r of detectRefs(body)) {
    const k = `${r.type}:${r.id}`;
    if (want.has(k)) continue;
    if (await peek(ctx.tx, ctx.user.id, r, m.orgId)) want.set(k, { ...r, origin: 'system' });
  }
  const cur = await ctx.tx.query<LinkRow>(
    `select ${LINK_COLS} from app.links where from_type = 'message' and from_id = $1 and relation = 'references' and deleted_at is null`,
    [m.messageId],
  );
  const have = new Set(cur.rows.map((l) => `${l.to_type}:${l.to_id}`));
  await softDelete(ctx, cur.rows.filter((l) => !want.has(`${l.to_type}:${l.to_id}`)), m.context, m.causeId);
  for (const [k, r] of want) {
    if (have.has(k)) continue;
    await insertLink(ctx, { orgId: m.orgId, from: { type: 'message', id: m.messageId }, to: r, relation: 'references', origin: r.origin }, m.context, m.causeId);
  }
}

/** Tin bị xoá: references/resolution từ tin bị gỡ; created_from trỏ tới tin được giữ (F10-T5). */
export async function onMessageDeleted(ctx: CommandCtx, messageId: string, context: ActCtx, causeId: string) {
  const rows = await ctx.tx.query<LinkRow>(
    `select ${LINK_COLS} from app.links where from_type = 'message' and from_id = $1 and relation in ('references', 'resolution') and deleted_at is null`,
    [messageId],
  );
  await softDelete(ctx, rows.rows, context, causeId);
}

/** created_from: chỉ hệ thống, trong lệnh tạo Task từ tin nhắn. */
export async function linkTaskToSource(ctx: CommandCtx, orgId: string, taskId: string, messageId: string, context: ActCtx, causeId: string) {
  await insertLink(ctx, { orgId, from: { type: 'task', id: taskId }, to: { type: 'message', id: messageId }, relation: 'created_from', origin: 'system' }, context, causeId);
}

/** Thẻ dưới mỗi tin (X2): references từ tin + Task tạo từ tin, theo quyền người xem. */
export async function cardsFor(db: Queryable, viewerId: string, messageIds: string[]): Promise<Map<string, ObjectCardDto[]>> {
  const out = new Map<string, ObjectCardDto[]>();
  if (!messageIds.length) return out;
  const r = await db.query<LinkRow>(
    `select ${LINK_COLS} from app.links
      where deleted_at is null and ((from_type = 'message' and from_id = any($1::uuid[]) and relation = 'references')
                                 or (to_type = 'message' and to_id = any($1::uuid[]) and relation = 'created_from'))
      order by created_at`,
    [messageIds],
  );
  for (const l of r.rows) {
    const created = l.relation === 'created_from';
    const msgId = created ? l.to_id : l.from_id;
    const ref: Ref = created ? { type: 'task', id: l.from_id } : { type: l.to_type as WorkType, id: l.to_id };
    const p = await peek(db, viewerId, ref);
    const list = out.get(msgId) ?? [];
    list.push({ relation: created ? 'created_from' : 'references', ...ref, available: !!p, title: p?.title ?? null, subtitle: p?.subtitle ?? null });
    out.set(msgId, list);
  }
  return out;
}

interface MsgInfo {
  id: string;
  conversation_id: string;
  anchor_type: 'group' | 'event' | 'task';
  anchor_id: string;
  anchor_name: string | null;
  sender_name: string | null;
  body: string | null;
  created_at: Date;
  deleted_at: Date | null;
}
async function messageInfo(db: Queryable, ids: string[]) {
  if (!ids.length) return new Map<string, MsgInfo>();
  const r = await db.query<MsgInfo>(
    `select m.id, m.conversation_id, c.anchor_type, c.anchor_id, coalesce(g.name, e.title, t.title) as anchor_name,
            u.display_name as sender_name, m.body, m.created_at, m.deleted_at
       from app.messages m join app.conversations c on c.id = m.conversation_id
       left join app.groups g on g.id = c.anchor_id and c.anchor_type = 'group'
       left join app.events e on e.id = c.anchor_id and c.anchor_type = 'event'
       left join app.tasks t on t.id = c.anchor_id and c.anchor_type = 'task'
       left join app.users u on u.id = m.sender_id
      where m.id = any($1::uuid[])`,
    [ids],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}
const readable = async (db: Queryable, userId: string, messageId: string) =>
  viewMessage(db, userId, messageId).then(
    () => true,
    (e) => {
      if (e instanceof AppError && e.code === 'not_found') return false;
      throw e;
    },
  );
const excerpt = (s: string | null) => (s ?? '').slice(0, 200);

/** Nguồn gốc Task (CONTEXT_ENGINE §3.2): tin gốc xoá hoặc không đọc được → "không khả dụng" (F10-T2, T5). */
export async function taskSource(db: Queryable, userId: string, taskId: string): Promise<TaskSourceDto | null> {
  const l = await db.query<{ to_id: string }>(
    `select to_id from app.links where from_type = 'task' and from_id = $1 and relation = 'created_from' and deleted_at is null limit 1`,
    [taskId],
  );
  if (!l.rows[0]) return null;
  const id = l.rows[0].to_id;
  const m = (await messageInfo(db, [id])).get(id);
  if (!m || m.deleted_at || !(await readable(db, userId, id))) {
    return { available: false, messageId: null, conversationId: null, anchor: null, senderName: null, excerpt: null };
  }
  return {
    available: true,
    messageId: id,
    conversationId: m.conversation_id,
    anchor: { type: m.anchor_type, id: m.anchor_id, name: m.anchor_name ?? '' },
    senderName: m.sender_name,
    excerpt: excerpt(m.body),
  };
}

/** Khối Liên quan của Event/Task (CONTEXT_ENGINE §3.1, §3.2; F10-T4). */
export async function related(db: Queryable, userId: string, type: 'event' | 'task', id: string): Promise<RelatedDto> {
  const self = type === 'event' ? await viewEvent(db, userId, id) : await viewTask(db, userId, id);
  const canEditSelf = type === 'event' ? can(self.actor, 'event.edit', self.obj as never).allowed : can(self.actor, 'task.edit', self.obj as never).allowed;
  const r = await db.query<LinkRow>(
    `select ${LINK_COLS} from app.links
      where deleted_at is null and relation in ('references', 'resolution')
        and ((to_type = $1 and to_id = $2) or (from_type = $1 and from_id = $2))
      order by created_at desc limit 200`,
    [type, id],
  );
  let hidden = 0;
  const msgLinks = r.rows.filter((l) => l.from_type === 'message');
  const infos = await messageInfo(db, msgLinks.map((l) => l.from_id));
  const messages: RelatedDto['messages'] = [];
  for (const l of msgLinks) {
    const m = infos.get(l.from_id);
    if (!m || m.deleted_at) continue;
    if (!(await readable(db, userId, m.id))) {
      hidden++;
      continue;
    }
    messages.push({
      linkId: l.id,
      messageId: m.id,
      conversationId: m.conversation_id,
      anchor: { type: m.anchor_type, id: m.anchor_id, name: m.anchor_name ?? '' },
      senderName: m.sender_name,
      excerpt: excerpt(m.body),
      createdAt: m.created_at.toISOString(),
    });
  }
  const objects: RelatedDto['objects'] = [];
  for (const l of r.rows.filter((x) => x.from_type !== 'message')) {
    const other: Ref = l.from_type === type && l.from_id === id ? { type: l.to_type as WorkType, id: l.to_id } : { type: l.from_type as WorkType, id: l.from_id };
    const p = await peek(db, userId, other);
    if (!p) {
      hidden++;
      continue;
    }
    objects.push({ relation: 'references', ...other, available: true, title: p.title, subtitle: p.subtitle, linkId: l.id, canUnlink: canEditSelf || l.created_by === userId });
  }
  return { messages, objects, hiddenCount: hidden };
}

/** Quyền sửa một đối tượng công việc (để tạo/gỡ Link giữa hai đối tượng, §5). */
async function edits(db: Queryable, userId: string, r: { type: 'event' | 'task'; id: string }) {
  if (r.type === 'event') {
    const v = await viewEvent(db, userId, r.id);
    return { orgId: v.row.org_id, ok: can(v.actor, 'event.edit', v.obj).allowed };
  }
  const v = await viewTask(db, userId, r.id);
  return { orgId: v.row.org_id, ok: can(v.actor, 'task.edit', v.obj).allowed || managesTask(v.actor, v.obj) };
}

/** Link `references` giữa hai đối tượng công việc: sửa được ít nhất một đầu và xem được đầu kia (§5). */
export async function linkObjects(ctx: CommandCtx, from: { type: 'event' | 'task'; id: string }, to: { type: 'event' | 'task'; id: string }) {
  if (from.type === to.type && from.id === to.id) throw new AppError('validation_failed', 'Không liên kết một đối tượng với chính nó', { fields: { to: 'self' } });
  const a = await edits(ctx.tx, ctx.user.id, from);
  const b = await edits(ctx.tx, ctx.user.id, to);
  if (a.orgId !== b.orgId) throw notFound();
  if (!a.ok && !b.ok) throw new AppError('forbidden', 'Cần quyền sửa ít nhất một đối tượng');
  // Một cặp chỉ một Link dù theo chiều nào.
  const exists = await ctx.tx.query<{ id: string }>(
    `select id from app.links where deleted_at is null and relation = 'references'
        and ((from_type = $1 and from_id = $2 and to_type = $3 and to_id = $4) or (from_type = $3 and from_id = $4 and to_type = $1 and to_id = $2))`,
    [from.type, from.id, to.type, to.id],
  );
  if (exists.rows[0]) return { linkId: exists.rows[0].id };
  const context: ActCtx = from.type === 'event' ? { eventId: from.id } : { taskId: from.id };
  const id = await insertLink(ctx, { orgId: a.orgId, from, to, relation: 'references', origin: 'manual' }, context);
  return { linkId: id! };
}

/** Gỡ Link: người tạo, hoặc người quản lý một trong hai đầu (§5). Link created_from không gỡ tay. */
export async function unlink(ctx: CommandCtx, linkId: string) {
  const r = await ctx.tx.query<LinkRow>(`select ${LINK_COLS} from app.links where id = $1 and deleted_at is null for update`, [linkId]);
  const l = r.rows[0];
  if (!l) throw notFound();
  if (l.relation === 'created_from') throw new AppError('forbidden', 'Nguồn gốc của việc không gỡ được');
  const ends: Array<{ type: string; id: string }> = [
    { type: l.from_type, id: l.from_id },
    { type: l.to_type, id: l.to_id },
  ];
  let allowed = l.created_by === ctx.user.id;
  let seen = false;
  for (const e of ends) {
    if (e.type !== 'event' && e.type !== 'task') {
      if (e.type === 'message' && (await readable(ctx.tx, ctx.user.id, e.id))) seen = true;
      continue;
    }
    const v = await edits(ctx.tx, ctx.user.id, e as { type: 'event' | 'task'; id: string }).catch(() => null);
    if (v) seen = true;
    if (v?.ok) allowed = true;
  }
  if (!seen) throw notFound();
  assertAllowed(allowed ? { allowed: true } : { allowed: false, deny: 'forbidden', reason: 'requires link creator or manager of an end' });
  const ctxCols: ActCtx = l.from_type === 'event' ? { eventId: l.from_id } : l.from_type === 'task' ? { taskId: l.from_id } : {};
  await softDelete(ctx, [l], ctxCols);
  return { linkId, removed: true };
}

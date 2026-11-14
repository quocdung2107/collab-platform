import type { ConversationSummaryDto, MessageDto, MessagePageDto } from '@collab/shared';
import type { Queryable, Tx } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { normalizeText } from '../../lib/text.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type ConversationObject, type MessageObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { emit } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { topics } from '../realtime/publisher.js';

/**
 * Module Messaging (F9, PERMISSION_MODEL §4.3, EVENT_API_CONTRACTS §5.8).
 * Lát S4: hội thoại anchor = group. Mỗi nhóm đúng một hội thoại, tạo cùng lúc với nhóm.
 */

interface ConvRow {
  id: string;
  org_id: string;
  anchor_type: 'group';
  anchor_id: string;
  anchor_name: string;
  last_seq: string;
  last_message_at: Date | null;
  read_only: boolean;
}

const CONV_SELECT = `
  select c.id, c.org_id, c.anchor_type, c.anchor_id, g.name as anchor_name, c.last_seq, c.last_message_at, c.read_only
    from app.conversations c
    join app.groups g on g.id = c.anchor_id and c.anchor_type = 'group'
    join app.organizations o on o.id = c.org_id and o.deleted_at is null`;

const toObject = (c: ConvRow): ConversationObject => ({
  type: 'conversation',
  id: c.id,
  orgId: c.org_id,
  anchor: { type: 'group', id: c.anchor_id },
  readOnly: c.read_only,
});

/** Tạo hội thoại cho nhóm (gọi trong giao dịch tạo nhóm). */
export async function ensureGroupConversation(tx: Tx, orgId: string, groupId: string) {
  await tx.query(
    `insert into app.conversations (org_id, anchor_type, anchor_id) values ($1, 'group', $2) on conflict (anchor_type, anchor_id) do nothing`,
    [orgId, groupId],
  );
}

/** Nhóm lưu trữ → hội thoại chỉ-đọc (DATA_MODEL §5). */
export async function setGroupConversationReadOnly(tx: Tx, groupId: string) {
  await tx.query(`update app.conversations set read_only = true where anchor_type = 'group' and anchor_id = $1`, [groupId]);
}

async function loadConversation(db: Queryable, userId: string, conversationId: string, forUpdate = false) {
  const r = await db.query<ConvRow>(`${CONV_SELECT} where c.id = $1 ${forUpdate ? 'for update of c' : ''}`, [conversationId]);
  const conv = r.rows[0];
  if (!conv) throw notFound();
  const actor = await loadActorContext(db, userId, conv.org_id);
  const obj = toObject(conv);
  assertAllowed(can(actor, 'conversation.read', obj));
  return { conv, actor, obj };
}

async function summaries(db: Queryable, userId: string, where: string, params: unknown[]): Promise<ConversationSummaryDto[]> {
  const r = await db.query<ConvRow & { last_read_seq: string | null; unread: number }>(
    `${CONV_SELECT.replace('select c.id', `select coalesce(s.last_read_seq, 0) as last_read_seq,
            (select count(*)::int from app.messages m
              where m.conversation_id = c.id and m.seq > coalesce(s.last_read_seq, 0)
                and m.deleted_at is null and m.sender_id is distinct from $1) as unread,
            c.id`)}
       left join app.conversation_states s on s.conversation_id = c.id and s.user_id = $1
      where ${where}
      order by c.last_message_at desc nulls last, g.name_norm`,
    [userId, ...params],
  );
  return r.rows.map((c) => ({
    id: c.id,
    orgId: c.org_id,
    anchor: { type: c.anchor_type, id: c.anchor_id, name: c.anchor_name },
    lastSeq: Number(c.last_seq),
    lastMessageAt: c.last_message_at?.toISOString() ?? null,
    lastReadSeq: Number(c.last_read_seq ?? 0),
    unreadCount: c.unread,
    readOnly: c.read_only,
  }));
}

/** Tab Chat: hội thoại của các nhóm người dùng là thành viên (DATA_MODEL §3.5). */
export async function listConversations(db: Queryable, userId: string, orgId: string) {
  await viewOrg(db, userId, orgId);
  return summaries(
    db,
    userId,
    `c.org_id = $2 and exists (select 1 from app.group_members gm where gm.group_id = c.anchor_id and gm.user_id = $1)`,
    [orgId],
  );
}

async function summaryOf(db: Queryable, userId: string, conversationId: string) {
  return (await summaries(db, userId, 'c.id = $2', [conversationId]))[0]!;
}

/** Hội thoại của một nhóm (để mở chat từ trang nhóm). */
export async function getGroupConversation(db: Queryable, userId: string, groupId: string) {
  const r = await db.query<{ id: string }>(`select id from app.conversations where anchor_type = 'group' and anchor_id = $1`, [groupId]);
  if (!r.rows[0]) throw notFound();
  await loadConversation(db, userId, r.rows[0].id);
  return summaryOf(db, userId, r.rows[0].id);
}

const MESSAGE_SELECT = `
  select m.id, m.seq, m.kind, m.sender_id, su.display_name as sender_name, m.body, m.client_msg_id,
         m.created_at, m.edited_at, m.deleted_at,
         r.id as reply_id, r.seq as reply_seq, ru.display_name as reply_sender, left(r.body, 140) as reply_excerpt,
         coalesce((select json_agg(json_build_object('userId', mm.user_id, 'displayName', mu.display_name) order by mu.display_name)
                     from app.message_mentions mm join app.users mu on mu.id = mm.user_id
                    where mm.message_id = m.id), '[]') as mentions
    from app.messages m
    left join app.users su on su.id = m.sender_id
    left join app.messages r on r.id = m.reply_to_id
    left join app.users ru on ru.id = r.sender_id`;

interface MessageRow {
  id: string;
  seq: string;
  kind: 'user' | 'system';
  sender_id: string | null;
  sender_name: string | null;
  body: string | null;
  client_msg_id: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reply_id: string | null;
  reply_seq: string | null;
  reply_sender: string | null;
  reply_excerpt: string | null;
  mentions: Array<{ userId: string; displayName: string }>;
}

const toMessage = (m: MessageRow): MessageDto => ({
  id: m.id,
  seq: Number(m.seq),
  kind: m.kind,
  senderId: m.sender_id,
  senderName: m.sender_name,
  body: m.body,
  replyTo: m.reply_id ? { id: m.reply_id, seq: Number(m.reply_seq), senderName: m.reply_sender, excerpt: m.reply_excerpt } : null,
  // Tin đã xoá: không còn mention, không còn nội dung (DATA_MODEL §5).
  mentions: m.deleted_at ? [] : m.mentions,
  clientMsgId: m.client_msg_id,
  createdAt: m.created_at.toISOString(),
  editedAt: m.edited_at?.toISOString() ?? null,
  deleted: m.deleted_at !== null,
});

async function messageById(db: Queryable, id: string) {
  const r = await db.query<MessageRow>(`${MESSAGE_SELECT} where m.id = $1`, [id]);
  return toMessage(r.rows[0]!);
}

export async function getMessages(
  db: Queryable,
  userId: string,
  conversationId: string,
  q: { beforeSeq?: number; afterSeq?: number; limit: number },
): Promise<MessagePageDto> {
  await loadConversation(db, userId, conversationId);
  const params: unknown[] = [conversationId, q.limit + 1];
  let where = 'm.conversation_id = $1';
  let order = 'desc';
  if (q.afterSeq !== undefined) {
    params.push(q.afterSeq);
    where += ` and m.seq > $${params.length}`;
    order = 'asc';
  } else if (q.beforeSeq !== undefined) {
    params.push(q.beforeSeq);
    where += ` and m.seq < $${params.length}`;
  }
  const r = await db.query<MessageRow>(`${MESSAGE_SELECT} where ${where} order by m.seq ${order} limit $2`, params);
  const rows = r.rows.slice(0, q.limit);
  if (order === 'desc') rows.reverse();
  return {
    conversation: await summaryOf(db, userId, conversationId),
    messages: rows.map(toMessage),
    hasMore: q.afterSeq === undefined && r.rows.length > q.limit,
  };
}

/** Mention chỉ người đọc được hội thoại (§4.3): thành viên nhóm anchor có membership tổ chức active. */
async function assertMentionable(db: Queryable, conv: ConvRow, ids: string[]) {
  if (!ids.length) return;
  const r = await db.query<{ user_id: string }>(
    `select gm.user_id from app.group_members gm
       join app.memberships ms on ms.org_id = gm.org_id and ms.user_id = gm.user_id and ms.status = 'active'
      where gm.group_id = $1 and gm.user_id = any($2::uuid[])`,
    [conv.anchor_id, ids],
  );
  if (r.rowCount !== ids.length) {
    throw new AppError('validation_failed', 'Chỉ nhắc được người trong hội thoại', { fields: { mentionIds: 'not_a_reader' } });
  }
}

async function markReadUpTo(tx: Tx, conversationId: string, userId: string, seq: number) {
  await tx.query(
    `insert into app.conversation_states (conversation_id, user_id, last_read_seq) values ($1, $2, $3)
     on conflict (conversation_id, user_id)
     do update set last_read_seq = greatest(app.conversation_states.last_read_seq, excluded.last_read_seq), updated_at = now()`,
    [conversationId, userId, seq],
  );
}

export interface SendInput {
  clientMsgId: string;
  body: string;
  replyToId?: string;
  mentionIds: string[];
}

/**
 * Gửi tin (§5.8). Khoá dòng hội thoại để cấp seq tuần tự (F9-T2) và để kiểm tra client_msg_id
 * an toàn khi gửi lặp đồng thời (F9-T1): trùng → trả lại tin đã tạo, không cấp seq mới.
 */
export async function sendMessage(ctx: CommandCtx, conversationId: string, input: SendInput): Promise<{ created: boolean; message: MessageDto }> {
  const { conv, actor, obj } = await loadConversation(ctx.tx, ctx.user.id, conversationId, true);
  const existing = await ctx.tx.query<{ id: string }>(
    `select id from app.messages where conversation_id = $1 and sender_id = $2 and client_msg_id = $3`,
    [conversationId, ctx.user.id, input.clientMsgId],
  );
  if (existing.rows[0]) return { created: false, message: await messageById(ctx.tx, existing.rows[0].id) };

  assertAllowed(can(actor, 'conversation.post', obj));
  const mentionIds = [...new Set(input.mentionIds)];
  await assertMentionable(ctx.tx, conv, mentionIds);

  let replyToSenderId: string | null = null;
  if (input.replyToId) {
    const r = await ctx.tx.query<{ sender_id: string | null }>(`select sender_id from app.messages where id = $1 and conversation_id = $2`, [
      input.replyToId,
      conversationId,
    ]);
    if (!r.rows[0]) throw new AppError('validation_failed', 'Tin được trả lời không thuộc hội thoại này', { fields: { replyToId: 'other_conversation' } });
    replyToSenderId = r.rows[0].sender_id;
  }

  const seqRow = await ctx.tx.query<{ last_seq: string }>(
    `update app.conversations set last_seq = last_seq + 1, last_message_at = now() where id = $1 returning last_seq`,
    [conversationId],
  );
  const seq = Number(seqRow.rows[0]!.last_seq);
  const body = input.body.trim();
  const ins = await ctx.tx.query<{ id: string }>(
    `insert into app.messages (org_id, conversation_id, seq, kind, sender_id, body, body_norm, reply_to_id, client_msg_id)
     values ($1, $2, $3, 'user', $4, $5, $6, $7, $8) returning id`,
    [conv.org_id, conversationId, seq, ctx.user.id, body, normalizeText(body), input.replyToId ?? null, input.clientMsgId],
  );
  const messageId = ins.rows[0]!.id;
  if (mentionIds.length) {
    await ctx.tx.query(
      `insert into app.message_mentions (message_id, user_id, org_id, conversation_id) select $1, unnest($2::uuid[]), $3, $4`,
      [messageId, mentionIds, conv.org_id, conversationId],
    );
  }
  await markReadUpTo(ctx.tx, conversationId, ctx.user.id, seq);

  const activityId = await emit(ctx, {
    orgId: conv.org_id,
    verb: 'message.created',
    object: { type: 'message', id: messageId },
    context: { groupId: conv.anchor_id, conversationId },
    payload: {
      message_id: messageId,
      seq,
      sender_id: ctx.user.id,
      mention_ids: mentionIds,
      reply_to_sender_id: replyToSenderId,
      has_attachments: false,
    },
  });
  await ctx.realtime.send(ctx.tx, topics.conversation(conversationId), 'conversation.message', {
    type: 'message',
    id: messageId,
    verb: 'message.created',
    activity_id: activityId,
    conversation_id: conversationId,
    seq,
  });
  return { created: true, message: await messageById(ctx.tx, messageId) };
}

async function loadMessage(ctx: CommandCtx, messageId: string) {
  const r = await ctx.tx.query<{ conversation_id: string; kind: 'user' | 'system'; sender_id: string | null; deleted_at: Date | null; seq: string }>(
    `select conversation_id, kind, sender_id, deleted_at, seq from app.messages where id = $1 for update`,
    [messageId],
  );
  const m = r.rows[0];
  if (!m) throw notFound();
  const { conv, actor, obj } = await loadConversation(ctx.tx, ctx.user.id, m.conversation_id);
  const msgObj: MessageObject = {
    type: 'message',
    id: messageId,
    orgId: conv.org_id,
    conversation: obj,
    kind: m.kind,
    senderId: m.sender_id,
    deleted: m.deleted_at !== null,
  };
  return { m, conv, actor, msgObj };
}

/** Sửa tin của mình; mention thêm/bớt ghi vào sự kiện để notifier chỉ báo người mới (F9-T6). */
export async function editMessage(ctx: CommandCtx, messageId: string, input: { body: string; mentionIds: string[] }) {
  const { m, conv, actor, msgObj } = await loadMessage(ctx, messageId);
  assertAllowed(can(actor, 'message.edit', msgObj));
  const mentionIds = [...new Set(input.mentionIds)];
  await assertMentionable(ctx.tx, conv, mentionIds);

  const before = await ctx.tx.query<{ user_id: string }>(`select user_id from app.message_mentions where message_id = $1`, [messageId]);
  const prev = new Set(before.rows.map((r) => r.user_id));
  const added = mentionIds.filter((id) => !prev.has(id));
  const removed = [...prev].filter((id) => !mentionIds.includes(id));
  const body = input.body.trim();

  await ctx.tx.query(`update app.messages set body = $2, body_norm = $3, edited_at = now() where id = $1`, [messageId, body, normalizeText(body)]);
  if (removed.length) await ctx.tx.query(`delete from app.message_mentions where message_id = $1 and user_id = any($2::uuid[])`, [messageId, removed]);
  if (added.length) {
    await ctx.tx.query(
      `insert into app.message_mentions (message_id, user_id, org_id, conversation_id) select $1, unnest($2::uuid[]), $3, $4`,
      [messageId, added, conv.org_id, conv.id],
    );
  }
  const activityId = await emit(ctx, {
    orgId: conv.org_id,
    verb: 'message.edited',
    object: { type: 'message', id: messageId },
    context: { groupId: conv.anchor_id, conversationId: conv.id },
    payload: { message_id: messageId, added_mention_ids: added, removed_mention_ids: removed },
  });
  await signalChanged(ctx, conv.id, messageId, Number(m.seq), 'edited', 'message.edited', activityId);
  return messageById(ctx.tx, messageId);
}

/** Xoá tin: nội dung đặt null ngay, mention bị gỡ; dòng giữ lại để seq liền mạch (DATA_MODEL §5, F9-T5). */
export async function deleteMessage(ctx: CommandCtx, messageId: string) {
  const { m, conv, actor, msgObj } = await loadMessage(ctx, messageId);
  assertAllowed(can(actor, 'message.delete', msgObj));
  await ctx.tx.query(`update app.messages set body = null, body_norm = null, deleted_at = now(), deleted_by = $2 where id = $1`, [
    messageId,
    ctx.user.id,
  ]);
  await ctx.tx.query(`delete from app.message_mentions where message_id = $1`, [messageId]);
  const activityId = await emit(ctx, {
    orgId: conv.org_id,
    verb: 'message.deleted',
    object: { type: 'message', id: messageId },
    context: { groupId: conv.anchor_id, conversationId: conv.id },
    payload: { message_id: messageId, deleted_by: ctx.user.id },
  });
  await signalChanged(ctx, conv.id, messageId, Number(m.seq), 'deleted', 'message.deleted', activityId);
  return messageById(ctx.tx, messageId);
}

async function signalChanged(
  ctx: CommandCtx,
  conversationId: string,
  messageId: string,
  seq: number,
  change: 'edited' | 'deleted',
  verb: string,
  activityId: string,
) {
  await ctx.realtime.send(ctx.tx, topics.conversation(conversationId), 'conversation.message_changed', {
    type: 'message',
    id: messageId,
    verb,
    activity_id: activityId,
    conversation_id: conversationId,
    seq,
    change,
  });
}

/** Đánh dấu đã đọc tới seq (không vượt last_seq; không lùi). Không phải sự kiện miền. */
export async function markRead(ctx: CommandCtx, conversationId: string, seq: number) {
  const { conv } = await loadConversation(ctx.tx, ctx.user.id, conversationId);
  await markReadUpTo(ctx.tx, conversationId, ctx.user.id, Math.min(seq, Number(conv.last_seq)));
  return summaryOf(ctx.tx, ctx.user.id, conversationId);
}

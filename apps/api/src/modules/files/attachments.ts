import { randomUUID } from 'node:crypto';
import type { AttachmentDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type Decision } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { viewMessage } from '../messaging/conversations.js';
import { topics } from '../realtime/publisher.js';
import { viewEvent } from '../scheduling/access.js';
import { viewTask } from '../tasks/access.js';
import { DOWNLOAD_TTL_SEC, type FileStorage } from './storage.js';

/**
 * Tệp đính kèm (F9b, PERMISSION_MODEL §4.7, DATA_MODEL §8). Luồng: xin URL tải lên (khoá gắn tổ chức + người tải)
 * → máy khách tải thẳng lên Storage → gắn khoá vào tin/Event/Task (Backend kiểm tra tệp có thật, đúng người tải).
 * Tải xuống: view(attachment) = view của đối tượng sở hữu, rồi mới ký URL ngắn hạn (F14-T4).
 */

export const MAX_BYTES = 20 * 1024 * 1024;
export interface UploadRef {
  key: string;
  filename: string;
}

interface Row {
  id: string;
  org_id: string;
  owner_type: 'message' | 'event' | 'task';
  owner_id: string;
  storage_key: string;
  filename: string;
  mime: string;
  size_bytes: string;
  uploaded_by: string;
  uploader_name: string;
  created_at: Date;
  removed_at: Date | null;
}
const SELECT = `select a.id, a.org_id, a.owner_type, a.owner_id, a.storage_key, a.filename, a.mime, a.size_bytes, a.uploaded_by,
                       u.display_name as uploader_name, a.created_at, a.removed_at
                  from app.attachments a join app.users u on u.id = a.uploaded_by`;
const toDto = (r: Row): AttachmentDto => ({
  id: r.id,
  filename: r.filename,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  uploadedBy: { userId: r.uploaded_by, displayName: r.uploader_name },
  createdAt: r.created_at.toISOString(),
});

const safeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(-100) || 'tep';

/** Xin URL tải lên: thành viên tổ chức; khoá = {org}/{người tải}/{ngẫu nhiên}/{tên}. Không phải sự kiện miền. */
export async function requestUpload(db: Queryable, storage: FileStorage, userId: string, orgId: string, input: { filename: string; size: number }) {
  await viewOrg(db, userId, orgId);
  if (input.size > MAX_BYTES) throw new AppError('validation_failed', 'Tệp tối đa 20 MB', { fields: { size: 'too_large' } });
  const key = `${orgId}/${userId}/${randomUUID()}/${safeName(input.filename)}`;
  const s = await storage.signUpload(key);
  return { key, uploadUrl: s.url, token: s.token };
}

/** Khoá phải do chính người gọi xin trong đúng tổ chức, đã tải lên thật, chưa gắn ở đâu. */
async function claim(ctx: CommandCtx, storage: FileStorage, orgId: string, u: UploadRef) {
  if (!u.key.startsWith(`${orgId}/${ctx.user.id}/`)) throw new AppError('validation_failed', 'Tệp không hợp lệ', { fields: { attachments: 'foreign_key' } });
  const used = await ctx.tx.query(`select 1 from app.attachments where storage_key = $1`, [u.key]);
  if (used.rowCount) throw new AppError('validation_failed', 'Tệp đã được gắn', { fields: { attachments: 'already_attached' } });
  const st = await storage.stat(u.key);
  if (!st) throw new AppError('validation_failed', 'Tệp chưa tải lên xong', { fields: { attachments: 'not_uploaded' } });
  if (st.size > MAX_BYTES) throw new AppError('validation_failed', 'Tệp tối đa 20 MB', { fields: { attachments: 'too_large' } });
  return { size: st.size, mime: st.mime ?? 'application/octet-stream' };
}

async function insert(ctx: CommandCtx, storage: FileStorage, orgId: string, owner: { type: Row['owner_type']; id: string }, u: UploadRef) {
  const st = await claim(ctx, storage, orgId, u);
  const r = await ctx.tx.query<{ id: string }>(
    `insert into app.attachments (org_id, owner_type, owner_id, storage_key, filename, mime, size_bytes, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgId, owner.type, owner.id, u.key, u.filename.trim().slice(0, 255) || 'tệp', st.mime, st.size, ctx.user.id],
  );
  return r.rows[0]!.id;
}

/** Gắn tệp vào tin vừa gửi (trong cùng giao dịch gửi tin). */
export async function attachToMessage(ctx: CommandCtx, storage: FileStorage, orgId: string, messageId: string, uploads: UploadRef[]) {
  for (const u of uploads) await insert(ctx, storage, orgId, { type: 'message', id: messageId }, u);
}

/** Thêm vào Event: quyền sửa Event; vào Task: task_manager, owner, collaborator (§4.7). */
async function ownerAccess(db: Queryable, userId: string, owner: { type: 'event' | 'task'; id: string }) {
  if (owner.type === 'event') {
    const v = await viewEvent(db, userId, owner.id);
    return { orgId: v.row.org_id, write: can(v.actor, 'event.edit', v.obj), context: { eventId: owner.id }, topic: topics.event(owner.id) };
  }
  const v = await viewTask(db, userId, owner.id);
  return {
    orgId: v.row.org_id,
    write: can(v.actor, 'task.flag', v.obj),
    context: { taskId: owner.id, ...(v.row.event_id ? { eventId: v.row.event_id } : {}), ...(v.row.group_id ? { groupId: v.row.group_id } : {}) },
    topic: topics.task(owner.id),
  };
}

export async function addAttachment(ctx: CommandCtx, storage: FileStorage, owner: { type: 'event' | 'task'; id: string }, u: UploadRef) {
  const a = await ownerAccess(ctx.tx, ctx.user.id, owner);
  assertAllowed(a.write);
  const id = await insert(ctx, storage, a.orgId, owner, u);
  await emit(
    ctx,
    { orgId: a.orgId, verb: 'attachment.added', object: { type: 'attachment', id }, context: a.context, payload: { attachment_id: id, owner } },
    [a.topic],
  );
  return getOne(ctx.tx, id);
}

async function getOne(db: Queryable, id: string) {
  return toDto((await db.query<Row>(`${SELECT} where a.id = $1`, [id])).rows[0]!);
}

/** view(attachment) = view của đối tượng sở hữu (Message → view(message)); tin đã xoá → không còn tệp. */
async function viewAttachment(db: Queryable, userId: string, id: string) {
  const r = await db.query<Row>(`${SELECT} where a.id = $1 and a.removed_at is null`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound();
  if (row.owner_type === 'message') {
    const m = await viewMessage(db, userId, row.owner_id);
    const del = await db.query(`select 1 from app.messages where id = $1 and deleted_at is null`, [row.owner_id]);
    if (!del.rowCount) throw notFound();
    const own = row.uploaded_by === userId;
    const msg = { type: 'message' as const, id: row.owner_id, orgId: row.org_id, conversation: m.obj, kind: 'user' as const, senderId: row.uploaded_by, deleted: false };
    return { row, remove: own ? ({ allowed: true } as Decision) : can(m.actor, 'message.delete', msg), context: { conversationId: m.conv.id } };
  }
  const a = await ownerAccess(db, userId, { type: row.owner_type, id: row.owner_id });
  return { row, remove: row.uploaded_by === userId ? ({ allowed: true } as Decision) : a.write, context: a.context, topic: a.topic };
}

/** URL tải ngắn hạn (F14-T4): không xem được → not_found. */
export async function downloadUrl(db: Queryable, storage: FileStorage, userId: string, id: string) {
  const { row } = await viewAttachment(db, userId, id);
  const url = await storage.signDownload(row.storage_key, DOWNLOAD_TTL_SEC, row.filename);
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SEC * 1000).toISOString() };
}

/** Gỡ: người tải lên, hoặc người có quyền sửa đối tượng sở hữu (§4.7). Xoá mềm; nội dung dọn sau. */
export async function removeAttachment(ctx: CommandCtx, id: string) {
  const v = await viewAttachment(ctx.tx, ctx.user.id, id);
  assertAllowed(v.remove);
  await ctx.tx.query(`update app.attachments set removed_at = now(), removed_by = $2 where id = $1`, [id, ctx.user.id]);
  if (v.row.owner_type !== 'message') {
    await emit(
      ctx,
      {
        orgId: v.row.org_id,
        verb: 'attachment.removed',
        object: { type: 'attachment', id },
        context: v.context,
        payload: { attachment_id: id, owner: { type: v.row.owner_type, id: v.row.owner_id } },
      },
      v.topic ? [v.topic] : [],
    );
  }
  return { id, removed: true };
}

export async function listFor(db: Queryable, userId: string, owner: { type: 'event' | 'task'; id: string }) {
  await ownerAccess(db, userId, owner);
  const r = await db.query<Row>(`${SELECT} where a.owner_type = $1 and a.owner_id = $2 and a.removed_at is null order by a.created_at`, [owner.type, owner.id]);
  return r.rows.map(toDto);
}

/** Tệp của các tin (người xem đã đọc được hội thoại); tin đã xoá → không trả tệp. */
export async function messageAttachments(db: Queryable, messageIds: string[]) {
  const out = new Map<string, AttachmentDto[]>();
  if (!messageIds.length) return out;
  const r = await db.query<Row>(
    `${SELECT} join app.messages m on m.id = a.owner_id and m.deleted_at is null
      where a.owner_type = 'message' and a.owner_id = any($1::uuid[]) and a.removed_at is null order by a.created_at`,
    [messageIds],
  );
  for (const row of r.rows) out.set(row.owner_id, [...(out.get(row.owner_id) ?? []), toDto(row)]);
  return out;
}

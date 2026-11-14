import type { TaskDto, TaskSummaryDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { normalizeText } from '../../lib/text.js';
import { assertAllowed } from '../access/authorize.js';
import { can, forcedAcceptance, managesTask, viewsTask, type ActorContext, type TaskAction, type TaskDraftObject, type TaskObject } from '../access/can.js';
import { loadActorContext } from '../access/context.js';
import { emit, signalAccessChanged } from '../activity/emit.js';
import { viewGroup } from '../groups/groups.js';
import { ensureTaskConversation } from '../messaging/conversations.js';
import { topics } from '../realtime/publisher.js';
import { viewEvent } from '../scheduling/access.js';
import { TASK_COLS, taskObjects, viewTask, type TaskRow } from './access.js';

/**
 * Module Task (F8, PERMISSION_MODEL §4.6, EVENT_API_CONTRACTS §2.3, §5.6, §5.7).
 * Mỗi lệnh phát đúng một verb (trừ tạo có owner: task.created + task.assigned con; sửa cả nội dung lẫn hạn:
 * task.updated + task.due_changed con). Lệnh đổi trạng thái/giao lại đòi expectedVersion (F8-T5).
 */

type Ctx = { taskId: string; eventId?: string; groupId?: string };
const contextOf = (r: Pick<TaskRow, 'id' | 'event_id' | 'group_id'>): Ctx => ({
  taskId: r.id,
  ...(r.event_id ? { eventId: r.event_id } : {}),
  ...(r.group_id ? { groupId: r.group_id } : {}),
});
const topicsOf = (r: Pick<TaskRow, 'id' | 'event_id' | 'group_id'>) => [
  topics.task(r.id),
  ...(r.event_id ? [topics.event(r.event_id)] : []),
  ...(r.group_id ? [topics.group(r.group_id)] : []),
];
const OPEN = new Set(['open', 'in_progress']);

// ——— Đọc ———

async function people(db: Queryable, ids: Array<string | null>) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const r = await db.query<{ id: string; display_name: string }>(`select id, display_name from app.users where id = any($1::uuid[])`, [list]);
  return new Map(r.rows.map((u) => [u.id, u.display_name]));
}

async function scopeNames(db: Queryable, rows: TaskRow[]) {
  const ev = rows.filter((r) => r.event_id).map((r) => r.event_id!);
  const gr = rows.filter((r) => r.group_id).map((r) => r.group_id!);
  const [e, g] = await Promise.all([
    ev.length ? db.query<{ id: string; title: string }>(`select id, title from app.events where id = any($1::uuid[])`, [ev]) : Promise.resolve({ rows: [] }),
    gr.length ? db.query<{ id: string; name: string }>(`select id, name from app.groups where id = any($1::uuid[])`, [gr]) : Promise.resolve({ rows: [] }),
  ]);
  return new Map<string, string>([...e.rows.map((x) => [x.id, x.title] as const), ...g.rows.map((x) => [x.id, x.name] as const)]);
}

const isOverdue = (r: TaskRow) => !!r.due_at && OPEN.has(r.status) && r.due_at.getTime() < Date.now();
const scopeOf = (r: TaskRow, names: Map<string, string>) => {
  const id = r.event_id ?? r.group_id;
  return { type: r.scope_type, id, name: id ? (names.get(id) ?? null) : null };
};

export async function taskDetail(db: Queryable, row: TaskRow, obj: TaskObject, actor: ActorContext): Promise<TaskDto> {
  const names = await people(db, [row.owner_id, row.assigned_by, row.created_by, ...obj.collaboratorIds]);
  const person = (id: string | null) => (id ? { userId: id, displayName: names.get(id) ?? '' } : null);
  const conv = await db.query<{ id: string }>(`select id from app.conversations where anchor_type = 'task' and anchor_id = $1`, [row.id]);
  const allowed = (a: TaskAction) => can(actor, a, obj).allowed;
  const manager = managesTask(actor, obj);
  const open = OPEN.has(row.status);
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    scope: scopeOf(row, await scopeNames(db, [row])),
    owner: person(row.owner_id),
    assignedBy: person(row.assigned_by),
    createdBy: person(row.created_by)!,
    collaborators: obj.collaboratorIds.map((id) => person(id)!).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    requiresAcceptance: row.requires_acceptance,
    acceptance: row.acceptance,
    declineReason: manager || row.owner_id === actor.userId ? row.decline_reason : null,
    status: row.status,
    blocked: row.blocked,
    needsHelp: row.needs_help,
    dueAt: row.due_at?.toISOString() ?? null,
    dueOffsetMin: row.due_offset_min,
    overdue: isOverdue(row),
    completedAt: row.completed_at?.toISOString() ?? null,
    conversationId: conv.rows[0]?.id ?? null,
    version: row.version,
    can: {
      edit: row.status !== 'cancelled' && allowed('task.edit'),
      assign: open && allowed('task.assign'),
      respond: open && row.acceptance === 'pending' && allowed('task.respond'),
      status: row.status !== 'cancelled' && allowed('task.status'),
      reopenCancel: allowed('task.reopen_cancel'),
      flag: open && allowed('task.flag'),
      collaborators: open && allowed('task.collaborators'),
    },
  };
}

export async function getTask(db: Queryable, userId: string, taskId: string) {
  const { row, obj, actor } = await viewTask(db, userId, taskId);
  return taskDetail(db, row, obj, actor);
}

async function summaries(db: Queryable, rows: TaskRow[]): Promise<TaskSummaryDto[]> {
  const [names, scopes] = await Promise.all([people(db, rows.map((r) => r.owner_id)), scopeNames(db, rows)]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    scope: scopeOf(r, scopes),
    owner: r.owner_id ? { userId: r.owner_id, displayName: names.get(r.owner_id) ?? '' } : null,
    acceptance: r.acceptance,
    status: r.status,
    blocked: r.blocked,
    needsHelp: r.needs_help,
    dueAt: r.due_at?.toISOString() ?? null,
    overdue: isOverdue(r),
  }));
}

const LIST_ORDER = `order by case when t.status in ('open', 'in_progress') then 0 else 1 end, t.due_at nulls last, t.created_at`;

/** Task của một buổi: ai xem được buổi thì xem được Task của buổi (§3). */
export async function listEventTasks(db: Queryable, userId: string, eventId: string) {
  await viewEvent(db, userId, eventId);
  const r = await db.query<TaskRow>(`select ${TASK_COLS.replace(/(^|, )/g, '$1t.')} from app.tasks t where t.event_id = $1 ${LIST_ORDER}`, [eventId]);
  return summaries(db, r.rows);
}

/** Task của một nhóm, lọc theo view(task) (người ngoài nhóm chỉ thấy Task mình tham gia, §5). */
export async function listGroupTasks(db: Queryable, userId: string, groupId: string) {
  const { actor } = await viewGroup(db, userId, groupId);
  const r = await db.query<TaskRow>(`select ${TASK_COLS.replace(/(^|, )/g, '$1t.')} from app.tasks t where t.group_id = $1 ${LIST_ORDER}`, [groupId]);
  const objs = await taskObjects(db, r.rows);
  return summaries(db, r.rows.filter((x) => viewsTask(actor, objs.get(x.id)!)));
}

// ——— Lệnh ———

async function forCommand(ctx: CommandCtx, taskId: string, expectedVersion?: number) {
  const v = await viewTask(ctx.tx, ctx.user.id, taskId, true);
  if (expectedVersion !== undefined && v.row.version !== expectedVersion) {
    throw new AppError('version_conflict', 'Việc đã được người khác sửa', { current: await taskDetail(ctx.tx, v.row, v.obj, v.actor) });
  }
  return v;
}

async function refreshed(ctx: CommandCtx, taskId: string) {
  const v = await viewTask(ctx.tx, ctx.user.id, taskId).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') return null;
    throw e;
  });
  return v ? taskDetail(ctx.tx, v.row, v.obj, v.actor) : null;
}

const notOpen = (r: TaskRow) => {
  if (!OPEN.has(r.status)) throw new AppError('invalid_transition', r.status === 'done' ? 'Việc đã xong' : 'Việc đã huỷ');
};

/** Người được giao / người cùng làm phải là thành viên active và xem được Task sau khi giao (§4.6). */
async function assertCanHold(ctx: CommandCtx, obj: TaskObject, userId: string, as: 'owner' | 'collaborator', field: string) {
  const m = await ctx.tx.query(`select 1 from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`, [obj.orgId, userId]);
  if (!m.rowCount) throw new AppError('not_a_member', 'Người này không phải thành viên của tổ chức');
  const them = await loadActorContext(ctx.tx, userId, obj.orgId);
  const after: TaskObject = as === 'owner' ? { ...obj, ownerId: userId } : { ...obj, collaboratorIds: [...obj.collaboratorIds, userId] };
  if (!viewsTask(them, after)) {
    throw new AppError('validation_failed', 'Người này không xem được buổi của việc', { fields: { [field]: 'cannot_view' } });
  }
}

/** Người vừa mất vai trò: không còn xem được Task → xoá Subscription, báo access_changed (như IN-26). */
async function afterLosingRole(ctx: CommandCtx, taskId: string, userId: string, activityId: string) {
  const r = await ctx.tx.query<TaskRow>(`select ${TASK_COLS} from app.tasks where id = $1`, [taskId]);
  const obj = (await taskObjects(ctx.tx, r.rows)).get(taskId)!;
  const them = await loadActorContext(ctx.tx, userId, obj.orgId);
  if (them.orgRole && viewsTask(them, obj)) return;
  const conv = await ctx.tx.query<{ id: string }>(`select id from app.conversations where anchor_type = 'task' and anchor_id = $1`, [taskId]);
  await ctx.tx.query(
    `delete from app.subscriptions where user_id = $1 and ((target_type = 'task' and target_id = $2) or (target_type = 'conversation' and target_id = $3))`,
    [userId, taskId, conv.rows[0]?.id ?? null],
  );
  await signalAccessChanged(ctx, userId, { type: 'task', id: taskId, activityId });
}

export interface CreateTaskInput {
  orgId?: string;
  title: string;
  description?: string | null;
  scope: { type: 'event' | 'group' | 'private'; eventId?: string; groupId?: string };
  ownerId?: string | null;
  requiresAcceptance?: boolean;
  dueAt?: string | null;
  dueOffsetMin?: number | null;
}

export async function createTask(ctx: CommandCtx, input: CreateTaskInput) {
  const s = input.scope;
  let orgId: string;
  let draft: TaskDraftObject;
  let eventStartsAt: Date | null = null;
  if (s.type === 'event') {
    if (!s.eventId) throw new AppError('validation_failed', 'Thiếu buổi', { fields: { 'scope.eventId': 'required' } });
    const ev = await viewEvent(ctx.tx, ctx.user.id, s.eventId);
    orgId = ev.row.org_id;
    eventStartsAt = ev.row.starts_at;
    draft = { type: 'task_draft', orgId, scopeType: 'event', event: ev.obj, groupId: null };
  } else if (s.type === 'group') {
    if (!s.groupId) throw new AppError('validation_failed', 'Thiếu nhóm', { fields: { 'scope.groupId': 'required' } });
    const g = await viewGroup(ctx.tx, ctx.user.id, s.groupId);
    if (g.group.archived_at) throw new AppError('forbidden', 'Nhóm đã lưu trữ');
    orgId = g.group.org_id;
    draft = { type: 'task_draft', orgId, scopeType: 'group', event: null, groupId: s.groupId };
  } else {
    if (!input.orgId) throw new AppError('validation_failed', 'Thiếu tổ chức', { fields: { orgId: 'required' } });
    orgId = input.orgId;
    draft = { type: 'task_draft', orgId, scopeType: 'private', event: null, groupId: null };
  }
  const actor = await loadActorContext(ctx.tx, ctx.user.id, orgId);
  assertAllowed(can(actor, 'task.create', draft));

  const due = resolveDue(input.dueAt, input.dueOffsetMin, s.type, eventStartsAt);
  const ownerId = input.ownerId ?? null;
  const probe: TaskObject = {
    type: 'task',
    id: '00000000-0000-0000-0000-000000000000',
    orgId,
    scopeType: draft.scopeType,
    event: draft.event,
    groupId: draft.groupId,
    ownerId: null,
    assignedBy: ownerId ? ctx.user.id : null,
    createdBy: ctx.user.id,
    collaboratorIds: [],
    status: 'open',
  };
  if (ownerId) await assertCanHold(ctx, probe, ownerId, 'owner', 'ownerId');
  const requires = forcedAcceptance(actor, draft, ownerId, input.requiresAcceptance ?? false);
  const acceptance = ownerId && ownerId !== ctx.user.id ? (requires ? 'pending' : 'none') : 'none';
  const title = input.title.trim();

  const r = await ctx.tx.query<TaskRow>(
    `insert into app.tasks (org_id, scope_type, event_id, group_id, title, title_norm, description, owner_id, assigned_by, created_by,
                            requires_acceptance, acceptance, due_at, due_offset_min)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning ${TASK_COLS}`,
    [
      orgId,
      s.type,
      draft.event?.id ?? null,
      draft.groupId,
      title,
      normalizeText(title),
      input.description?.trim() || null,
      ownerId,
      ownerId ? ctx.user.id : null,
      ctx.user.id,
      requires,
      acceptance,
      due.dueAt,
      due.offset,
    ],
  );
  const row = r.rows[0]!;
  const rootId = await emit(
    ctx,
    {
      orgId,
      verb: 'task.created',
      object: { type: 'task', id: row.id },
      context: contextOf(row),
      payload: { title, scope_type: s.type, event_id: row.event_id, group_id: row.group_id, due_at: row.due_at?.toISOString() ?? null },
    },
    topicsOf(row),
  );
  if (ownerId) {
    await emit(ctx, {
      orgId,
      verb: 'task.assigned',
      object: { type: 'task', id: row.id },
      context: contextOf(row),
      causeId: rootId,
      payload: { from_owner_id: null, to_owner_id: ownerId, assigned_by: ctx.user.id, requires_acceptance: requires },
    });
  }
  // Người tạo tự theo dõi Task nếu không phải owner (NOTIFICATION_ENGINE §6 quy tắc 6).
  if (ownerId !== ctx.user.id) {
    await ctx.tx.query(
      `insert into app.subscriptions (user_id, org_id, target_type, target_id, mode, created_by) values ($1, $2, 'task', $3, 'follow', $1)
       on conflict do nothing`,
      [ctx.user.id, orgId, row.id],
    );
  }
  return (await refreshed(ctx, row.id))!;
}

function resolveDue(dueAt: string | null | undefined, offset: number | null | undefined, scope: string, startsAt: Date | null) {
  if (offset !== undefined && offset !== null) {
    if (scope !== 'event' || !startsAt) throw new AppError('validation_failed', 'Hạn tương đối chỉ dùng cho việc của buổi', { fields: { dueOffsetMin: 'event_only' } });
    if (dueAt) throw new AppError('validation_failed', 'Chọn hạn cố định hoặc hạn theo buổi', { fields: { dueAt: 'conflict' } });
    return { dueAt: new Date(startsAt.getTime() + offset * 60_000), offset };
  }
  return { dueAt: dueAt ? new Date(dueAt) : null, offset: null };
}

/** Giao / giao lại / bỏ giao (§5.7). */
export async function assignTask(ctx: CommandCtx, taskId: string, input: { ownerId: string | null; expectedVersion: number; requiresAcceptance?: boolean }) {
  const { row, obj, actor } = await forCommand(ctx, taskId, input.expectedVersion);
  assertAllowed(can(actor, 'task.assign', obj));
  notOpen(row);
  const to = input.ownerId;
  if (to === row.owner_id && row.acceptance !== 'declined') return (await refreshed(ctx, taskId))!;
  if (to) await assertCanHold(ctx, obj, to, 'owner', 'ownerId');
  const requires = forcedAcceptance(actor, obj, to, input.requiresAcceptance ?? row.requires_acceptance);
  const acceptance = to && to !== ctx.user.id && requires ? 'pending' : 'none';
  await ctx.tx.query(
    `update app.tasks set owner_id = $2, assigned_by = $3, requires_acceptance = $4, acceptance = $5, decline_reason = null,
            version = version + 1, updated_at = now() where id = $1`,
    [taskId, to, to ? ctx.user.id : row.assigned_by, requires, acceptance],
  );
  const id = await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'task.assigned',
      object: { type: 'task', id: taskId },
      context: contextOf(row),
      payload: { from_owner_id: row.owner_id, to_owner_id: to, assigned_by: ctx.user.id, requires_acceptance: requires },
    },
    topicsOf(row),
  );
  if (row.owner_id && row.owner_id !== to) await afterLosingRole(ctx, taskId, row.owner_id, id);
  return refreshed(ctx, taskId);
}

/** Nhận / từ chối (owner). Lặp lại cùng câu trả lời: không đổi gì; khác: state_conflict (như IN-26). */
export async function respondTask(ctx: CommandCtx, taskId: string, input: { response: 'accept' | 'decline'; reason?: string }) {
  const { row, obj, actor } = await forCommand(ctx, taskId);
  assertAllowed(can(actor, 'task.respond', obj));
  notOpen(row);
  const want = input.response === 'accept' ? 'accepted' : 'declined';
  if (row.acceptance === want) return (await refreshed(ctx, taskId))!;
  if (row.acceptance !== 'pending') throw new AppError('state_conflict', 'Việc không còn chờ trả lời', { current: { acceptance: row.acceptance } });
  await ctx.tx.query(`update app.tasks set acceptance = $2, decline_reason = $3, version = version + 1, updated_at = now() where id = $1`, [
    taskId,
    want,
    want === 'declined' ? input.reason?.trim() || null : null,
  ]);
  await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: want === 'accepted' ? 'task.accepted' : 'task.declined',
      object: { type: 'task', id: taskId },
      context: contextOf(row),
      payload: want === 'accepted' ? { owner_id: ctx.user.id } : { owner_id: ctx.user.id, reason: input.reason?.trim() || null },
    },
    topicsOf(row),
  );
  return (await refreshed(ctx, taskId))!;
}

/** Tiến độ: open ↔ in_progress (status_changed), → done (completed), done → open (reopened, chỉ task_manager). */
export async function setTaskStatus(ctx: CommandCtx, taskId: string, input: { status: 'open' | 'in_progress' | 'done'; expectedVersion: number }) {
  const { row, obj, actor } = await forCommand(ctx, taskId, input.expectedVersion);
  if (row.status === 'cancelled') throw new AppError('invalid_transition', 'Việc đã huỷ');
  if (row.status === input.status) return (await refreshed(ctx, taskId))!;
  let verb: string;
  let payload: Record<string, unknown>;
  if (row.status === 'done') {
    if (input.status !== 'open') throw new AppError('invalid_transition', 'Mở lại việc trước khi đổi tiến độ');
    assertAllowed(can(actor, 'task.reopen_cancel', obj));
    verb = 'task.reopened';
    payload = {};
  } else {
    assertAllowed(can(actor, 'task.status', obj));
    verb = input.status === 'done' ? 'task.completed' : 'task.status_changed';
    payload = input.status === 'done' ? { completed_by: ctx.user.id } : { before: row.status, after: input.status };
  }
  await ctx.tx.query(
    `update app.tasks set status = $2,
            completed_at = case when $2 = 'done' then now() else null end,
            completed_by = case when $2 = 'done' then $3::uuid else null end,
            version = version + 1, updated_at = now() where id = $1`,
    [taskId, input.status, ctx.user.id],
  );
  await emit(ctx, { orgId: row.org_id, verb, object: { type: 'task', id: taskId }, context: contextOf(row), payload }, topicsOf(row));
  return (await refreshed(ctx, taskId))!;
}

export async function cancelTask(ctx: CommandCtx, taskId: string, input: { reason?: string; expectedVersion: number }) {
  const { row, obj, actor } = await forCommand(ctx, taskId, input.expectedVersion);
  assertAllowed(can(actor, 'task.reopen_cancel', obj));
  notOpen(row);
  await ctx.tx.query(`update app.tasks set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now() where id = $1`, [taskId]);
  await emit(
    ctx,
    { orgId: row.org_id, verb: 'task.cancelled', object: { type: 'task', id: taskId }, context: contextOf(row), payload: { reason: input.reason?.trim() || null } },
    topicsOf(row),
  );
  return (await refreshed(ctx, taskId))!;
}

/** Sửa tiêu đề/mô tả (task.updated, không chép nội dung) và/hoặc hạn (task.due_changed, by_reschedule = false). */
export async function updateTask(
  ctx: CommandCtx,
  taskId: string,
  input: { expectedVersion: number; title?: string; description?: string | null; dueAt?: string | null; dueOffsetMin?: number | null },
) {
  const { row, obj, actor } = await forCommand(ctx, taskId, input.expectedVersion);
  assertAllowed(can(actor, 'task.edit', obj));
  if (row.status === 'cancelled') throw new AppError('invalid_transition', 'Việc đã huỷ');
  const changes: string[] = [];
  const title = input.title?.trim();
  if (title !== undefined && title !== row.title) changes.push('title');
  const description = input.description === undefined ? row.description : input.description?.trim() || null;
  if (description !== row.description) changes.push('description');

  let due = { dueAt: row.due_at, offset: row.due_offset_min };
  if (input.dueAt !== undefined || input.dueOffsetMin !== undefined) {
    const startsAt = row.event_id ? (await ctx.tx.query<{ starts_at: Date }>(`select starts_at from app.events where id = $1`, [row.event_id])).rows[0]!.starts_at : null;
    due = resolveDue(input.dueAt, input.dueOffsetMin, row.scope_type, startsAt);
  }
  const dueChanged = (due.dueAt?.getTime() ?? null) !== (row.due_at?.getTime() ?? null);
  if (!changes.length && !dueChanged && due.offset === row.due_offset_min) return (await refreshed(ctx, taskId))!;

  await ctx.tx.query(
    `update app.tasks set title = $2, title_norm = $3, description = $4, due_at = $5, due_offset_min = $6, version = version + 1, updated_at = now() where id = $1`,
    [taskId, title ?? row.title, normalizeText(title ?? row.title), description, due.dueAt, due.offset],
  );
  let rootId: string | undefined;
  if (changes.length) {
    rootId = await emit(
      ctx,
      { orgId: row.org_id, verb: 'task.updated', object: { type: 'task', id: taskId }, context: contextOf(row), payload: { changes } },
      topicsOf(row),
    );
  }
  if (dueChanged) {
    await emit(
      ctx,
      {
        orgId: row.org_id,
        verb: 'task.due_changed',
        object: { type: 'task', id: taskId },
        context: contextOf(row),
        causeId: rootId,
        payload: { before: row.due_at?.toISOString() ?? null, after: due.dueAt?.toISOString() ?? null, by_reschedule: false },
      },
      rootId ? [] : topicsOf(row),
    );
  }
  return (await refreshed(ctx, taskId))!;
}

/** Cờ blocked / needs_help: mỗi cờ đổi phát một task.flag_changed. */
export async function setTaskFlags(ctx: CommandCtx, taskId: string, input: { blocked?: boolean; needsHelp?: boolean }) {
  const { row, obj, actor } = await forCommand(ctx, taskId);
  assertAllowed(can(actor, 'task.flag', obj));
  notOpen(row);
  const flips: Array<['blocked' | 'needs_help', boolean]> = [];
  if (input.blocked !== undefined && input.blocked !== row.blocked) flips.push(['blocked', input.blocked]);
  if (input.needsHelp !== undefined && input.needsHelp !== row.needs_help) flips.push(['needs_help', input.needsHelp]);
  if (!flips.length) return (await refreshed(ctx, taskId))!;
  await ctx.tx.query(`update app.tasks set blocked = $2, needs_help = $3, version = version + 1, updated_at = now() where id = $1`, [
    taskId,
    input.blocked ?? row.blocked,
    input.needsHelp ?? row.needs_help,
  ]);
  for (const [flag, value] of flips) {
    await emit(
      ctx,
      { orgId: row.org_id, verb: 'task.flag_changed', object: { type: 'task', id: taskId }, context: contextOf(row), payload: { flag, value } },
      topicsOf(row),
    );
  }
  return (await refreshed(ctx, taskId))!;
}

/** Thêm/gỡ người cùng làm. collaborator chỉ được tự gỡ mình (§4.6). */
export async function changeCollaborators(ctx: CommandCtx, taskId: string, input: { add?: string[]; remove?: string[] }) {
  const { row, obj, actor } = await forCommand(ctx, taskId);
  const add = [...new Set(input.add ?? [])].filter((u) => !obj.collaboratorIds.includes(u));
  const remove = [...new Set(input.remove ?? [])].filter((u) => obj.collaboratorIds.includes(u));
  const selfLeave = !add.length && remove.length === 1 && remove[0] === ctx.user.id;
  assertAllowed(can(actor, selfLeave ? 'task.collaborators.leave' : 'task.collaborators', obj));
  notOpen(row);
  for (const u of add) {
    if (u === row.owner_id) throw new AppError('validation_failed', 'Người phụ trách đã ở trong việc', { fields: { add: 'is_owner' } });
    await assertCanHold(ctx, obj, u, 'collaborator', 'add');
  }
  for (const u of add) {
    await ctx.tx.query(`insert into app.task_collaborators (task_id, user_id, org_id, added_by) values ($1, $2, $3, $4)`, [taskId, u, row.org_id, ctx.user.id]);
    await emit(
      ctx,
      { orgId: row.org_id, verb: 'task.collaborator_added', object: { type: 'task', id: taskId }, context: contextOf(row), payload: { user_id: u } },
      topicsOf(row),
    );
  }
  for (const u of remove) {
    await ctx.tx.query(`delete from app.task_collaborators where task_id = $1 and user_id = $2`, [taskId, u]);
    const id = await emit(
      ctx,
      {
        orgId: row.org_id,
        verb: 'task.collaborator_removed',
        object: { type: 'task', id: taskId },
        context: contextOf(row),
        payload: { user_id: u, by_self: u === ctx.user.id },
      },
      topicsOf(row),
    );
    await afterLosingRole(ctx, taskId, u, id);
  }
  return refreshed(ctx, taskId);
}

/** Mở thread trao đổi của Task (tạo nếu chưa có). Không phải sự kiện miền. */
export async function openTaskConversation(ctx: CommandCtx, taskId: string) {
  const { row } = await viewTask(ctx.tx, ctx.user.id, taskId);
  return { conversationId: await ensureTaskConversation(ctx.tx, row.org_id, taskId) };
}

/** Dùng cho registerViewer (N3) và Subscription. */
export const viewTaskOrThrow = (db: Queryable, userId: string, id: string) => viewTask(db, userId, id).catch((e) => {
  if (e instanceof AppError) throw e;
  throw notFound();
});

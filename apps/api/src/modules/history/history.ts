import type { HistoryEntryDto } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import { managesPosition, managesTask, type ActorContext, type EventObject, type TaskObject } from '../access/can.js';
import { CANCEL_REASON, lookup, when, type Lookup } from '../notifications/lookup.js';
import { viewEvent } from '../scheduling/access.js';
import { viewTask } from '../tasks/access.js';

/**
 * Lịch sử (F13, UX §4): dòng thời gian từ activity_events — ai, khi nào, gì, trước → sau.
 * Quyền: view đối tượng (X8); trường hạn chế (lý do từ chối) bị che theo quyền trường; hệ quả (cause_id) lồng dưới sự kiện gốc (F13-T3).
 * Tin nhắn không vào lịch sử (đã có ở Thảo luận).
 */

interface ARow {
  id: string;
  seq: string;
  verb: string;
  actor_id: string | null;
  object_id: string;
  task_id: string | null;
  cause_id: string | null;
  payload: Record<string, any>;
  occurred_at: Date;
}

interface Ctx {
  L: Lookup;
  tz: string;
  /** Viewer xem được lý do từ chối của dòng này không. */
  seesReason: (a: ARow) => Promise<boolean>;
}

const STATUS: Record<string, string> = { open: 'chưa làm', in_progress: 'đang làm', done: 'xong' };
const FIELD: Record<string, string> = { title: 'tên', description: 'mô tả', location: 'địa điểm', starts_at: 'giờ bắt đầu', ends_at: 'giờ kết thúc', visibility: 'phạm vi xem', group_ids: 'nhóm', due_at: 'hạn', name: 'tên', slots: 'số người', report_offset_min: 'giờ có mặt', notes: 'ghi chú' };

function fmt(k: string, v: unknown, tz: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if ((k.endsWith('_at') || k === 'before' || k === 'after') && typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return when(v, tz);
  if (Array.isArray(v)) return `${v.length}`;
  if (k === 'report_offset_min') return `${v} phút`;
  return String(v).slice(0, 120);
}

function changesOf(p: Record<string, any>, tz: string) {
  const c = (p.changes ?? {}) as Record<string, { before: unknown; after: unknown }>;
  return Object.entries(c)
    .filter(([k]) => k !== 'description')
    .map(([k, v]) => ({ field: FIELD[k] ?? k, before: fmt(k, v.before, tz), after: fmt(k, v.after, tz) }));
}

async function describe(a: ARow, x: Ctx): Promise<{ text: string; changes: HistoryEntryDto['changes'] } | null> {
  const p = a.payload;
  const who = (id: unknown) => x.L.userName(id as string);
  const pos = () => x.L.positionName(p.position_id);
  const reason = async (r: unknown) => (r && (await x.seesReason(a)) ? `: "${String(r).slice(0, 200)}"` : '');
  const none = [] as HistoryEntryDto['changes'];
  const onBehalf = async () => (p.responded_by && p.responded_by !== p.assignee_id ? ` (do ${await who(p.responded_by)} trả lời thay)` : '');
  switch (a.verb) {
    case 'event.created':
      return { text: 'Tạo buổi', changes: none };
    case 'event.published':
      return { text: 'Công bố buổi', changes: none };
    case 'event.updated':
      return { text: 'Sửa thông tin buổi', changes: changesOf(p, x.tz) };
    case 'event.rescheduled':
      return {
        text: `Dời giờ${p.reason ? `: ${String(p.reason).slice(0, 200)}` : ''}`,
        changes: [
          { field: 'giờ bắt đầu', before: when(p.before?.starts_at, x.tz), after: when(p.after?.starts_at, x.tz) },
          { field: 'giờ kết thúc', before: when(p.before?.ends_at, x.tz), after: when(p.after?.ends_at, x.tz) },
        ],
      };
    case 'event.relocated':
      return { text: 'Đổi địa điểm', changes: [{ field: 'địa điểm', before: fmt('location', p.before, x.tz), after: fmt('location', p.after, x.tz) }] };
    case 'event.cancelled':
      return { text: `Huỷ buổi${p.reason ? `: ${String(p.reason).slice(0, 200)}` : ''}`, changes: none };
    case 'event.owner_changed': {
      const add = await Promise.all(((p.added as string[]) ?? []).map(who));
      const rem = await Promise.all(((p.removed as string[]) ?? []).map(who));
      return { text: ['Người phụ trách', add.length ? `thêm ${add.join(', ')}` : '', rem.length ? `bỏ ${rem.join(', ')}` : ''].filter(Boolean).join(': ').replace(': bỏ', ', bỏ'), changes: none };
    }
    case 'position.created':
      return { text: `Thêm vị trí ${p.name ?? (await pos())} (${p.slots ?? 1} người)`, changes: none };
    case 'position.updated':
      return { text: `Sửa vị trí ${await x.L.positionName(a.object_id)}`, changes: changesOf(p, x.tz) };
    case 'position.removed':
      return { text: `Bỏ vị trí ${p.name ?? ''}`.trim(), changes: none };
    case 'assignment.requested':
      return { text: `Xếp ${await who(p.assignee_id)} vào ${await pos()}`, changes: none };
    case 'assignment.reconfirm_requested':
      return { text: `${await who(p.assignee_id)} cần xác nhận lại ${await pos()}`, changes: none };
    case 'assignment.accepted':
      return { text: `${await who(p.assignee_id)} nhận ${await pos()}${await onBehalf()}`, changes: none };
    case 'assignment.declined':
      return { text: `${await who(p.assignee_id)} từ chối ${await pos()}${await onBehalf()}${await reason(p.reason)}`, changes: none };
    case 'assignment.cancelled':
      return { text: `${await who(p.assignee_id)} không còn ở ${await pos()} (${CANCEL_REASON[p.cancel_reason] ?? p.cancel_reason})`, changes: none };
    case 'task.created':
      return { text: `Tạo việc "${String(p.title ?? '').slice(0, 120)}"`, changes: none };
    case 'task.assigned':
      return {
        text: p.to_owner_id ? `Giao cho ${await who(p.to_owner_id)}${p.requires_acceptance ? ' (cần nhận)' : ''}` : 'Việc không còn người phụ trách',
        changes: p.from_owner_id ? [{ field: 'người phụ trách', before: await who(p.from_owner_id), after: p.to_owner_id ? await who(p.to_owner_id) : '—' }] : none,
      };
    case 'task.accepted':
      return { text: `${await who(p.owner_id)} nhận việc`, changes: none };
    case 'task.declined':
      return { text: `${await who(p.owner_id)} từ chối việc${await reason(p.reason)}`, changes: none };
    case 'task.status_changed':
      return { text: 'Đổi tiến độ', changes: [{ field: 'tiến độ', before: STATUS[p.before] ?? p.before, after: STATUS[p.after] ?? p.after }] };
    case 'task.completed':
      return { text: 'Hoàn thành việc', changes: none };
    case 'task.reopened':
      return { text: 'Mở lại việc', changes: none };
    case 'task.cancelled':
      return { text: `Huỷ việc${p.reason ? `: ${String(p.reason).slice(0, 200)}` : ''}`, changes: none };
    case 'task.updated':
      return { text: 'Sửa việc', changes: changesOf(p, x.tz) };
    case 'task.due_changed':
      return { text: p.by_reschedule ? 'Hạn dời theo buổi' : 'Đổi hạn', changes: [{ field: 'hạn', before: fmt('before', p.before, x.tz), after: fmt('after', p.after, x.tz) }] };
    case 'task.flag_changed':
      return { text: `${p.value ? 'Bật' : 'Tắt'} cờ ${p.flag === 'needs_help' ? '"cần giúp"' : '"bị chặn"'}`, changes: none };
    case 'task.collaborator_added':
      return { text: `Thêm người cùng làm: ${await who(p.user_id)}`, changes: none };
    case 'task.collaborator_removed':
      return { text: `Bỏ người cùng làm: ${await who(p.user_id)}`, changes: none };
    case 'attachment.added':
      return { text: 'Thêm tệp', changes: none };
    case 'attachment.removed':
      return { text: 'Gỡ tệp', changes: none };
    case 'context.linked':
      return { text: 'Thêm liên kết', changes: none };
    case 'context.unlinked':
      return { text: 'Gỡ liên kết', changes: none };
    default:
      return null;
  }
}

async function build(db: Queryable, rows: ARow[], x: Ctx, owner: { taskId?: string }): Promise<HistoryEntryDto[]> {
  const byId = new Map<string, HistoryEntryDto>();
  const roots: HistoryEntryDto[] = [];
  const titles = new Map<string, string>();
  for (const a of rows) {
    const d = await describe(a, x);
    if (!d) continue;
    // Hệ quả lên Task hiện trong lịch sử Event: ghi rõ việc nào.
    if (a.task_id && a.task_id !== owner.taskId) {
      if (!titles.has(a.task_id)) titles.set(a.task_id, (await db.query<{ title: string }>(`select title from app.tasks where id = $1`, [a.task_id])).rows[0]?.title ?? 'việc');
      d.text = `Việc "${titles.get(a.task_id)}": ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)}`;
    }
    const entry: HistoryEntryDto = {
      id: a.id,
      verb: a.verb,
      actor: a.actor_id ? { userId: a.actor_id, displayName: await x.L.userName(a.actor_id) } : null,
      occurredAt: a.occurred_at.toISOString(),
      text: d.text,
      changes: d.changes,
      consequences: [],
    };
    byId.set(a.id, entry);
    const parent = a.cause_id ? byId.get(a.cause_id) : undefined;
    if (parent) parent.consequences.push(entry);
    else roots.push(entry);
  }
  return roots.reverse(); // mới nhất trước; hệ quả giữ thứ tự xảy ra
}

const SELECT = `select id, seq, verb, actor_id, object_id, task_id, cause_id, payload, occurred_at from app.activity_events`;

/** Lịch sử Event. Trước khi công bố chỉ người quản lý buổi thấy (bản nháp là riêng của họ). */
export async function eventHistory(db: Queryable, userId: string, eventId: string) {
  const v = await viewEvent(db, userId, eventId);
  const ev: EventObject = v.obj;
  const actor: ActorContext = v.actor;
  const managesEvent = managesPosition(actor, { type: 'position', id: null, orgId: ev.orgId, event: ev, groupId: null });
  const r = await db.query<ARow>(
    // Hoạt động riêng của Task nằm ở lịch sử Task; chỉ hệ quả của sự kiện Event (dời/huỷ) hiện ở đây.
    `${SELECT} a where a.event_id = $1 and a.verb not like 'message.%'
       and (a.task_id is null or a.cause_id in (select id from app.activity_events where event_id = $1 and task_id is null))
       and ($2 or a.verb = 'event.created' or (select published_at from app.events where id = $1) <= a.occurred_at)
     order by a.seq`,
    [eventId, managesEvent],
  );
  const groupOf = new Map<string, string | null>();
  const L = lookup(db);
  return build(db, r.rows, {
    L,
    tz: await L.orgTimezone(ev.orgId),
    seesReason: async (a) => {
      if (a.payload.assignee_id === userId) return true;
      const pid = a.payload.position_id as string;
      if (!groupOf.has(pid)) groupOf.set(pid, (await db.query<{ group_id: string | null }>(`select group_id from app.positions where id = $1`, [pid])).rows[0]?.group_id ?? null);
      return managesPosition(actor, { type: 'position', id: pid, orgId: ev.orgId, event: ev, groupId: groupOf.get(pid)! });
    },
  }, {});
}

/** Lịch sử Task: lý do từ chối chỉ task_manager và người từ chối thấy (như TaskDto.declineReason). */
export async function taskHistory(db: Queryable, userId: string, taskId: string) {
  const v = await viewTask(db, userId, taskId);
  const t: TaskObject = v.obj;
  const r = await db.query<ARow>(`${SELECT} where task_id = $1 and verb not like 'message.%' order by seq`, [taskId]);
  const L = lookup(db);
  return build(db, r.rows, {
    L,
    tz: await L.orgTimezone(t.orgId),
    seesReason: async (a) => a.payload.owner_id === userId || managesTask(v.actor, t),
  }, { taskId });
}

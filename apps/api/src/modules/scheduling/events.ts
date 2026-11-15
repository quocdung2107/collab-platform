import type { AssignmentDto, CreatedEventDto, EventDto, EventSummaryDto, PositionDto, TemplateDefinition } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { revokeLostViewers } from './lifecycle.js';
import { AppError } from '../../http/errors.js';
import { normalizeText } from '../../lib/text.js';
import { eventTaskSeeds } from './templates.js';
import { assertAllowed } from '../access/authorize.js';
import { can, managesPosition, viewsEvent, type ActorContext, type EventObject } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { ensureEventConversation } from '../messaging/conversations.js';
import { topics } from '../realtime/publisher.js';
import { ACTIVE, EVENT_COLS, eventObjects, OCCUPYING, viewEvent, type EventRow } from './access.js';

/**
 * Module Scheduling — Event (F3, PERMISSION_MODEL §4.4, EVENT_API_CONTRACTS §2.2, §5.1).
 * Lát S5: tạo (trống / mẫu / sao chép), sửa, xoá nháp, publish, người phụ trách.
 * Dời lịch, đổi địa điểm, huỷ Event đã publish: lát S9 (F7).
 */

const iso = (d: Date | null) => d?.toISOString() ?? null;

// ---------------------------------------------------------------- đọc

interface PositionRow {
  id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  slots: number;
  report_offset_min: number;
  sort: number;
  version: number;
}
interface AssignmentRow {
  id: string;
  position_id: string;
  user_id: string;
  display_name: string;
  status: AssignmentDto['status'];
  decline_reason: string | null;
  requested_at: Date | null;
  responded_at: Date | null;
  responded_by: string | null;
  version: number;
}

export async function eventDetail(db: Queryable, row: EventRow, obj: EventObject, actor: ActorContext): Promise<EventDto> {
  const [groups, owners, positions, assignments, conv] = await Promise.all([
    db.query<{ id: string; name: string }>(
      `select g.id, g.name from app.event_groups eg join app.groups g on g.id = eg.group_id where eg.event_id = $1 order by g.name_norm`,
      [row.id],
    ),
    db.query<{ user_id: string; display_name: string }>(
      `select eo.user_id, u.display_name from app.event_owners eo join app.users u on u.id = eo.user_id where eo.event_id = $1 order by u.display_name`,
      [row.id],
    ),
    db.query<PositionRow>(
      `select p.id, p.name, p.group_id, g.name as group_name, p.slots, p.report_offset_min, p.sort, p.version
         from app.positions p left join app.groups g on g.id = p.group_id
        where p.event_id = $1 and p.removed_at is null order by p.sort, p.name`,
      [row.id],
    ),
    db.query<AssignmentRow>(
      `select a.id, a.position_id, a.user_id, u.display_name, a.status, a.decline_reason, a.requested_at, a.responded_at, a.responded_by, a.version
         from app.assignments a join app.users u on u.id = a.user_id
        where a.event_id = $1 and a.status <> 'cancelled' order by a.created_at`,
      [row.id],
    ),
    db.query<{ id: string }>(`select id from app.conversations where anchor_type = 'event' and anchor_id = $1`, [row.id]),
  ]);

  const positionDtos: PositionDto[] = positions.rows.map((p) => {
    const pos = { type: 'position' as const, id: p.id, orgId: row.org_id, event: obj, groupId: p.group_id };
    const manager = managesPosition(actor, pos);
    const mine = assignments.rows.filter((a) => a.position_id === p.id);
    return {
      id: p.id,
      name: p.name,
      groupId: p.group_id,
      groupName: p.group_name,
      slots: p.slots,
      reportOffsetMin: p.report_offset_min,
      sort: p.sort,
      version: p.version,
      filled: mine.filter((a) => (OCCUPYING as readonly string[]).includes(a.status)).length,
      canManage: manager && row.status !== 'cancelled',
      assignments: mine
        .filter((a) => a.status !== 'draft' || manager) // Assignment draft chỉ position_manager thấy
        .map((a) => ({
          id: a.id,
          userId: a.user_id,
          displayName: a.display_name,
          status: a.status,
          declineReason: manager || a.user_id === actor.userId ? a.decline_reason : null, // trường hạn chế (T10)
          requestedAt: iso(a.requested_at),
          respondedAt: iso(a.responded_at),
          respondedBy: a.responded_by,
          version: a.version,
        })),
    };
  });

  const canEdit = can(actor, 'event.edit', obj).allowed;
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    visibility: row.visibility,
    templateId: row.template_id,
    copiedFrom: row.copied_from,
    groups: groups.rows,
    owners: owners.rows.map((o) => ({ userId: o.user_id, displayName: o.display_name })),
    publishedAt: iso(row.published_at),
    version: row.version,
    canEdit,
    canAddPositions: row.status !== 'cancelled' && (canEdit || obj.groupIds.some((g) => actor.groupRoles.get(g) === 'leader')),
    conversationId: conv.rows[0]?.id ?? null,
    positions: positionDtos,
  };
}

export async function getEvent(db: Queryable, userId: string, eventId: string) {
  const { row, obj, actor } = await viewEvent(db, userId, eventId);
  return eventDetail(db, row, obj, actor);
}

/** Lịch: Event người dùng xem được trong khoảng thời gian; lọc "của tôi" hoặc theo nhóm. */
export async function listEvents(
  db: Queryable,
  userId: string,
  orgId: string,
  q: { from: Date; to: Date; mine: boolean; groupId?: string },
): Promise<EventSummaryDto[]> {
  const { actor } = await viewOrg(db, userId, orgId);
  const r = await db.query<EventRow>(
    `select ${EVENT_COLS} from app.events
      where org_id = $1 and starts_at < $3 and ends_at > $2
        and ($4::uuid is null or exists (select 1 from app.event_groups eg where eg.event_id = id and eg.group_id = $4))
      order by starts_at
      limit 1000`,
    [orgId, q.from, q.to, q.groupId ?? null],
  );
  const objs = await eventObjects(db, r.rows);
  const visible = r.rows.filter((e) => viewsEvent(actor, objs.get(e.id)!));
  if (!visible.length) return [];
  const ids = visible.map((e) => e.id);
  const [groups, slots, mine] = await Promise.all([
    db.query<{ event_id: string; id: string; name: string }>(
      `select eg.event_id, g.id, g.name from app.event_groups eg join app.groups g on g.id = eg.group_id where eg.event_id = any($1::uuid[]) order by g.name_norm`,
      [ids],
    ),
    db.query<{ event_id: string; total: number; filled: number }>(
      `select p.event_id, sum(p.slots)::int as total,
              coalesce(sum((select count(*) from app.assignments a where a.position_id = p.id and a.status = any($2::text[]))), 0)::int as filled
         from app.positions p where p.event_id = any($1::uuid[]) and p.removed_at is null group by p.event_id`,
      [ids, ACTIVE],
    ),
    db.query<{ event_id: string; id: string; position_name: string; status: AssignmentDto['status']; report_offset_min: number }>(
      `select a.event_id, a.id, p.name as position_name, a.status, p.report_offset_min
         from app.assignments a join app.positions p on p.id = a.position_id
        where a.event_id = any($1::uuid[]) and a.user_id = $2 and a.status not in ('draft', 'cancelled')`,
      [ids, userId],
    ),
  ]);
  return visible
    .map((e) => {
      const myAssignments = mine.rows
        .filter((a) => a.event_id === e.id)
        .map((a) => ({
          id: a.id,
          positionName: a.position_name,
          status: a.status,
          reportAt: new Date(e.starts_at.getTime() + a.report_offset_min * 60_000).toISOString(),
        }));
      const s = slots.rows.find((x) => x.event_id === e.id);
      return {
        id: e.id,
        title: e.title,
        startsAt: e.starts_at.toISOString(),
        endsAt: e.ends_at.toISOString(),
        location: e.location,
        status: e.status,
        templateId: e.template_id,
        groups: groups.rows.filter((g) => g.event_id === e.id).map((g) => ({ id: g.id, name: g.name })),
        slotsTotal: s?.total ?? 0,
        slotsFilled: s?.filled ?? 0,
        myAssignments,
        canEdit: can(actor, 'event.edit', objs.get(e.id)!).allowed,
      };
    })
    .filter((e) => !q.mine || e.myAssignments.length > 0 || e.canEdit);
}

// ---------------------------------------------------------------- ghi

/** Nhóm phải thuộc tổ chức; nhóm đã lưu trữ bị loại và báo lại (F3-T6). */
async function activeGroups(db: Queryable, orgId: string, groupIds: string[]) {
  if (!groupIds.length) return { ok: [] as string[], archived: [] as string[], names: new Map<string, string>() };
  const r = await db.query<{ id: string; name: string; archived: boolean }>(
    `select id, name, archived_at is not null as archived from app.groups where org_id = $1 and id = any($2::uuid[])`,
    [orgId, groupIds],
  );
  const known = new Map(r.rows.map((g) => [g.id, g]));
  const missing = groupIds.filter((id) => !known.has(id));
  if (missing.length) throw new AppError('validation_failed', 'Nhóm không tồn tại', { fields: { groupIds: 'not_found' } });
  return {
    ok: r.rows.filter((g) => !g.archived).map((g) => g.id),
    archived: r.rows.filter((g) => g.archived).map((g) => g.id),
    names: new Map(r.rows.map((g) => [g.id, g.name])),
  };
}

export interface CreateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string;
  groupIds?: string[];
  visibility?: 'org' | 'groups';
  templateId?: string;
  copyFromId?: string;
  keepPeople?: boolean;
}

interface PositionSeed {
  name: string;
  groupId: string | null;
  slots: number;
  reportOffsetMin: number;
  people: string[];
}

export async function createEvent(ctx: CommandCtx, orgId: string, input: CreateEventInput): Promise<CreatedEventDto> {
  const { org, actor } = await viewOrg(ctx.tx, ctx.user.id, orgId);
  const warnings: CreatedEventDto['warnings'] = [];
  let title = input.title?.trim();
  let description = input.description ?? null;
  let location = input.location ?? null;
  let durationMin: number | null = null;
  let groupIds = input.groupIds ?? [];
  let seeds: PositionSeed[] = [];
  let templateId: string | null = null;
  let copiedFrom: string | null = null;
  let taskSeeds: Array<{ title: string; description: string | null; dueOffsetMin: number | null }> = [];

  if (input.templateId) {
    const t = await ctx.tx.query<{ id: string; name: string; definition: TemplateDefinition }>(
      `select id, name, definition from app.event_templates where id = $1 and org_id = $2 and archived_at is null`,
      [input.templateId, orgId],
    );
    if (!t.rows[0]) throw new AppError('validation_failed', 'Mẫu không tồn tại', { fields: { templateId: 'not_found' } });
    const def = t.rows[0].definition;
    templateId = t.rows[0].id;
    title ??= t.rows[0].name;
    durationMin = def.durationMin;
    if (!input.groupIds) groupIds = def.groupIds;
    seeds = def.positions.map((p) => ({ ...p, people: [] }));
    taskSeeds = def.tasks.map((t) => ({ title: t.title, description: null, dueOffsetMin: t.dueOffsetMin }));
  } else if (input.copyFromId) {
    const src = await viewEvent(ctx.tx, ctx.user.id, input.copyFromId).catch(() => {
      throw new AppError('validation_failed', 'Buổi nguồn không tồn tại', { fields: { copyFromId: 'not_found' } });
    });
    if (src.row.org_id !== orgId) throw new AppError('validation_failed', 'Buổi nguồn không tồn tại', { fields: { copyFromId: 'not_found' } });
    copiedFrom = src.row.id;
    title ??= src.row.title;
    description = input.description ?? src.row.description;
    location = input.location ?? src.row.location;
    durationMin = (src.row.ends_at.getTime() - src.row.starts_at.getTime()) / 60_000;
    if (!input.groupIds) groupIds = [...src.obj.groupIds];
    const pos = await ctx.tx.query<{ id: string; name: string; group_id: string | null; slots: number; report_offset_min: number }>(
      `select id, name, group_id, slots, report_offset_min from app.positions where event_id = $1 and removed_at is null order by sort, name`,
      [src.row.id],
    );
    // "Giữ nguyên người": chỉ người đang chiếm chỗ và còn là thành viên active; Assignment mới ở draft.
    const people = input.keepPeople
      ? await ctx.tx.query<{ position_id: string; user_id: string }>(
          `select a.position_id, a.user_id from app.assignments a
             join app.memberships m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
            where a.event_id = $1 and a.status = any($2::text[])`,
          [src.row.id, OCCUPYING],
        )
      : { rows: [] };
    seeds = pos.rows.map((p) => ({
      name: p.name,
      groupId: p.group_id,
      slots: p.slots,
      reportOffsetMin: p.report_offset_min,
      people: people.rows.filter((x) => x.position_id === p.id).map((x) => x.user_id),
    }));
    taskSeeds = await eventTaskSeeds(ctx.tx, src.row.id, src.row.starts_at);
  }

  if (!title) throw new AppError('validation_failed', 'Thiếu tiêu đề', { fields: { title: 'required' } });
  const startsAt = new Date(input.startsAt);
  const endsAt = input.endsAt ? new Date(input.endsAt) : durationMin !== null ? new Date(startsAt.getTime() + durationMin * 60_000) : null;
  if (!endsAt) throw new AppError('validation_failed', 'Thiếu giờ kết thúc', { fields: { endsAt: 'required' } });
  if (endsAt <= startsAt) throw new AppError('validation_failed', 'Giờ kết thúc phải sau giờ bắt đầu', { fields: { endsAt: 'before_start' } });

  // Nhóm không bao giờ bị xoá cứng, chỉ lưu trữ. Chọn tay nhóm đã lưu trữ → lỗi; từ mẫu/bản sao → bỏ qua và báo (F3-T6).
  const fromSource = !input.groupIds;
  const posGroupIds = seeds.map((x) => x.groupId).filter((x): x is string => x !== null);
  const g = await activeGroups(ctx.tx, orgId, [...new Set([...groupIds, ...posGroupIds])]);
  if (!fromSource && groupIds.some((id) => g.archived.includes(id))) {
    throw new AppError('validation_failed', 'Nhóm đã lưu trữ', { fields: { groupIds: 'archived' } });
  }
  const skipped = new Set<string>();
  groupIds = [...new Set(groupIds)].filter((id) => {
    if (g.ok.includes(id)) return true;
    skipped.add(id);
    return false;
  });
  for (const x of seeds) {
    if (x.groupId && !g.ok.includes(x.groupId)) {
      skipped.add(x.groupId);
      x.groupId = null;
    }
  }
  for (const id of skipped) warnings.push({ code: 'archived_group_skipped', detail: g.names.get(id) ?? id });

  assertAllowed(can(actor, 'event.create', { type: 'event_draft', orgId, groupIds }));

  const visibility = input.visibility ?? org.default_event_visibility;
  const ins = await ctx.tx.query<EventRow>(
    `insert into app.events (org_id, title, title_norm, description, location, starts_at, ends_at, visibility, template_id, copied_from, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning ${EVENT_COLS}`,
    [orgId, title, normalizeText(title), description, location, startsAt, endsAt, visibility, templateId, copiedFrom, ctx.user.id],
  );
  const row = ins.rows[0]!;
  await ctx.tx.query(`insert into app.event_owners (event_id, user_id, org_id, added_by) values ($1, $2, $3, $2)`, [row.id, ctx.user.id, orgId]);
  if (groupIds.length) {
    await ctx.tx.query(`insert into app.event_groups (event_id, group_id, org_id) select $1, unnest($2::uuid[]), $3`, [row.id, groupIds, orgId]);
  }
  const rootId = await emit(ctx, {
    orgId,
    verb: 'event.created',
    object: { type: 'event', id: row.id },
    context: { eventId: row.id },
    payload: { title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), template_id: templateId, copied_from: copiedFrom },
  });

  // Task mẫu / sao chép (F3): không người phụ trách, hạn theo buổi; sự kiện lúc nháp không báo ai (IN-24).
  for (const t of taskSeeds) {
    const k = await ctx.tx.query<{ id: string }>(
      `insert into app.tasks (org_id, scope_type, event_id, title, title_norm, description, created_by, due_at, due_offset_min)
       values ($1, 'event', $2, $3, $4, $5, $6, $7, $8) returning id`,
      [orgId, row.id, t.title, normalizeText(t.title), t.description, ctx.user.id, t.dueOffsetMin === null ? null : new Date(startsAt.getTime() + t.dueOffsetMin * 60_000), t.dueOffsetMin],
    );
    await emit(ctx, {
      orgId,
      verb: 'task.created',
      object: { type: 'task', id: k.rows[0]!.id },
      context: { taskId: k.rows[0]!.id, eventId: row.id },
      causeId: rootId,
      payload: { title: t.title, scope_type: 'event', event_id: row.id, group_id: null, due_at: null },
    });
  }

  const activeMembers = new Set(
    (
      await ctx.tx.query<{ user_id: string }>(`select user_id from app.memberships where org_id = $1 and status = 'active'`, [orgId])
    ).rows.map((r) => r.user_id),
  );
  for (const [i, s] of seeds.entries()) {
    const p = await ctx.tx.query<{ id: string }>(
      `insert into app.positions (org_id, event_id, name, group_id, slots, report_offset_min, sort) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [orgId, row.id, s.name, s.groupId, s.slots, s.reportOffsetMin, i],
    );
    const positionId = p.rows[0]!.id;
    await emit(ctx, {
      orgId,
      verb: 'position.created',
      object: { type: 'position', id: positionId },
      context: { eventId: row.id },
      causeId: rootId,
      payload: { name: s.name, group_id: s.groupId, slots: s.slots, report_offset_min: s.reportOffsetMin },
    });
    // Bản nháp: Assignment draft không phát sự kiện (EVENT_API_CONTRACTS §2.2).
    for (const userId of s.people.slice(0, s.slots)) {
      if (!activeMembers.has(userId)) continue;
      await ctx.tx.query(
        `insert into app.assignments (org_id, event_id, position_id, user_id, status, requested_by) values ($1,$2,$3,$4,'draft',$5)`,
        [orgId, row.id, positionId, userId, ctx.user.id],
      );
    }
  }

  const obj = (await eventObjects(ctx.tx, [row])).get(row.id)!;
  return { event: await eventDetail(ctx.tx, row, obj, actor), warnings };
}

export async function loadForEdit(ctx: CommandCtx, eventId: string, expectedVersion: number) {
  const v = await viewEvent(ctx.tx, ctx.user.id, eventId, true);
  assertAllowed(can(v.actor, 'event.edit', v.obj));
  if (v.row.version !== expectedVersion) {
    throw new AppError('version_conflict', 'Buổi đã được người khác sửa', { current: await eventDetail(ctx.tx, v.row, v.obj, v.actor) });
  }
  return v;
}

export interface UpdateEventInput {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  location?: string | null;
  startsAt?: string;
  endsAt?: string;
  groupIds?: string[];
  visibility?: 'org' | 'groups';
  /** Báo cả người được xếp về thay đổi (NOTIFICATION_ENGINE §5, event.updated). */
  notifyAssignees?: boolean;
}

export async function updateEvent(ctx: CommandCtx, eventId: string, input: UpdateEventInput) {
  const { row, obj, actor } = await loadForEdit(ctx, eventId, input.expectedVersion);
  if (row.status === 'cancelled') throw new AppError('invalid_transition', 'Buổi đã huỷ, không sửa được');

  const next = {
    title: input.title?.trim() ?? row.title,
    description: input.description === undefined ? row.description : input.description,
    location: input.location === undefined ? row.location : input.location,
    starts_at: input.startsAt ? new Date(input.startsAt) : row.starts_at,
    ends_at: input.endsAt ? new Date(input.endsAt) : row.ends_at,
    visibility: input.visibility ?? row.visibility,
  };
  if (next.ends_at <= next.starts_at) throw new AppError('validation_failed', 'Giờ kết thúc phải sau giờ bắt đầu', { fields: { endsAt: 'before_start' } });

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(next) as Array<keyof typeof next>) {
    const a = row[k] instanceof Date ? (row[k] as Date).toISOString() : row[k];
    const b = next[k] instanceof Date ? (next[k] as Date).toISOString() : next[k];
    if (a !== b) changes[k] = { before: a, after: b };
  }
  // Đã publish: đổi giờ / địa điểm đi qua lệnh dời lịch, đổi địa điểm (F7, lát S9) để báo đúng người.
  if (row.status === 'published' && (changes.starts_at || changes.ends_at || changes.location)) {
    throw new AppError('invalid_transition', 'Buổi đã gửi: dùng thao tác dời lịch / đổi địa điểm');
  }

  let groupIds = [...obj.groupIds];
  if (input.groupIds) {
    const g = await activeGroups(ctx.tx, row.org_id, input.groupIds);
    if (g.archived.length) throw new AppError('validation_failed', 'Nhóm đã lưu trữ', { fields: { groupIds: 'archived' } });
    const before = [...obj.groupIds].sort();
    const after = [...new Set(g.ok)].sort();
    if (before.join() !== after.join()) {
      changes.group_ids = { before, after };
      groupIds = after;
    }
  }
  if (!Object.keys(changes).length) return eventDetail(ctx.tx, row, obj, actor);

  const u = await ctx.tx.query<EventRow>(
    `update app.events set title = $2, title_norm = $3, description = $4, location = $5, starts_at = $6, ends_at = $7, visibility = $8,
            version = version + 1, updated_at = now()
      where id = $1 returning ${EVENT_COLS}`,
    [eventId, next.title, normalizeText(next.title), next.description, next.location, next.starts_at, next.ends_at, next.visibility],
  );
  if (changes.group_ids) {
    await ctx.tx.query(`delete from app.event_groups where event_id = $1`, [eventId]);
    if (groupIds.length) {
      await ctx.tx.query(`insert into app.event_groups (event_id, group_id, org_id) select $1, unnest($2::uuid[]), $3`, [eventId, groupIds, row.org_id]);
    }
  }
  const activityId = await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'event.updated',
      object: { type: 'event', id: eventId },
      context: { eventId },
      payload: { changes, notify_assignees: Boolean(input.notifyAssignees) },
    },
    row.status === 'draft' ? [] : [topics.event(eventId)],
  );
  const fresh = u.rows[0]!;
  const freshObj = (await eventObjects(ctx.tx, [fresh])).get(eventId)!;
  // Đổi visibility/nhóm làm mất quyền xem → xoá Subscription + access_changed (AD-31, §6 quy tắc 4).
  if (row.status !== 'draft' && (changes.visibility || changes.group_ids)) await revokeLostViewers(ctx, obj, freshObj, activityId);
  return eventDetail(ctx.tx, fresh, freshObj, actor);
}

/** Xoá bản nháp: xoá cứng Event, Position, Assignment draft và ActivityEvent của riêng nó (DATA_MODEL §5). */
export async function deleteDraft(ctx: CommandCtx, eventId: string, expectedVersion: number) {
  const { row } = await loadForEdit(ctx, eventId, expectedVersion);
  if (row.status !== 'draft') throw new AppError('invalid_transition', 'Chỉ xoá được bản nháp');
  await ctx.tx.query(`delete from app.activity_events where event_id = $1`, [eventId]);
  await ctx.tx.query(`delete from app.events where id = $1`, [eventId]);
  return { id: eventId, deleted: true };
}

/** Publish (§5.1): draft → published; tạo hội thoại Event; mọi Assignment draft → requested (sự kiện con). */
export async function publishEvent(ctx: CommandCtx, eventId: string, expectedVersion: number) {
  const { row, actor } = await loadForEdit(ctx, eventId, expectedVersion);
  if (row.status !== 'draft') throw new AppError('invalid_transition', 'Buổi đã được gửi trước đó');
  const owners = await ctx.tx.query(`select 1 from app.event_owners where event_id = $1`, [eventId]);
  if (!owners.rowCount) throw new AppError('invalid_transition', 'Buổi cần ít nhất một người phụ trách');

  const u = await ctx.tx.query<EventRow>(
    `update app.events set status = 'published', published_at = now(), version = version + 1, updated_at = now() where id = $1 returning ${EVENT_COLS}`,
    [eventId],
  );
  const fresh = u.rows[0]!;
  await ensureEventConversation(ctx.tx, row.org_id, eventId);
  const groupIds = (await ctx.tx.query<{ group_id: string }>(`select group_id from app.event_groups where event_id = $1`, [eventId])).rows.map(
    (g) => g.group_id,
  );
  const rootId = await emit(
    ctx,
    {
      orgId: row.org_id,
      verb: 'event.published',
      object: { type: 'event', id: eventId },
      context: { eventId },
      payload: { starts_at: fresh.starts_at.toISOString(), ends_at: fresh.ends_at.toISOString(), location: fresh.location, group_ids: groupIds },
    },
    [topics.event(eventId)],
  );
  const drafts = await ctx.tx.query<{ id: string; user_id: string; position_id: string }>(
    `update app.assignments set status = 'requested', requested_at = now(), requested_by = coalesce(requested_by, $2),
            version = version + 1, updated_at = now()
      where event_id = $1 and status = 'draft' returning id, user_id, position_id`,
    [eventId, ctx.user.id],
  );
  for (const a of drafts.rows) {
    const id = await emit(ctx, {
      orgId: row.org_id,
      verb: 'assignment.requested',
      object: { type: 'assignment', id: a.id },
      context: { eventId },
      causeId: rootId,
      payload: { assignee_id: a.user_id, position_id: a.position_id, requested_by: ctx.user.id, replaces_assignment_id: null },
    });
    await ctx.realtime.send(ctx.tx, topics.user(a.user_id), 'activity', { type: 'assignment', id: a.id, verb: 'assignment.requested', activity_id: id });
  }
  return {
    event: await eventDetail(ctx.tx, fresh, (await eventObjects(ctx.tx, [fresh])).get(eventId)!, actor),
    requestedCount: drafts.rowCount ?? 0,
  };
}

/** Thêm/gỡ người phụ trách; Event luôn còn ≥ 1 owner (§4.4). */
export async function changeOwners(ctx: CommandCtx, eventId: string, input: { expectedVersion: number; add: string[]; remove: string[] }) {
  const { row, actor } = await loadForEdit(ctx, eventId, input.expectedVersion);
  if (row.status === 'cancelled') throw new AppError('invalid_transition', 'Buổi đã huỷ');
  const add = [...new Set(input.add)];
  const remove = [...new Set(input.remove)].filter((id) => !add.includes(id));
  if (add.length) {
    const m = await ctx.tx.query(`select 1 from app.memberships where org_id = $1 and status = 'active' and user_id = any($2::uuid[])`, [
      row.org_id,
      add,
    ]);
    if (m.rowCount !== add.length) throw new AppError('not_a_member', 'Người phụ trách phải là thành viên của tổ chức');
  }
  const ins = add.length
    ? await ctx.tx.query<{ user_id: string }>(
        `insert into app.event_owners (event_id, user_id, org_id, added_by) select $1, unnest($2::uuid[]), $3, $4
         on conflict do nothing returning user_id`,
        [eventId, add, row.org_id, ctx.user.id],
      )
    : { rows: [] };
  const del = remove.length
    ? await ctx.tx.query<{ user_id: string }>(`delete from app.event_owners where event_id = $1 and user_id = any($2::uuid[]) returning user_id`, [
        eventId,
        remove,
      ])
    : { rows: [] };
  const left = await ctx.tx.query(`select 1 from app.event_owners where event_id = $1`, [eventId]);
  if (!left.rowCount) throw new AppError('validation_failed', 'Buổi phải còn ít nhất một người phụ trách', { fields: { remove: 'last_owner' } });

  const u = await ctx.tx.query<EventRow>(`update app.events set version = version + 1, updated_at = now() where id = $1 returning ${EVENT_COLS}`, [eventId]);
  const added = ins.rows.map((r) => r.user_id);
  const removed = del.rows.map((r) => r.user_id);
  if (added.length || removed.length) {
    await emit(
      ctx,
      { orgId: row.org_id, verb: 'event.owner_changed', object: { type: 'event', id: eventId }, context: { eventId }, payload: { added, removed } },
      row.status === 'draft' ? [] : [topics.event(eventId)],
    );
  }
  const fresh = u.rows[0]!;
  return eventDetail(ctx.tx, fresh, (await eventObjects(ctx.tx, [fresh])).get(eventId)!, actor);
}


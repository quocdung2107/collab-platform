import {
  addDaysIso,
  zonedToUtc,
  type RosterCellDto,
  type RosterColumnDto,
  type RosterImportInput,
  type RosterImportResultDto,
  type RosterPreviewDto,
  type RosterTotalsDto,
  type TemplateDefinition,
} from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { normalizeText } from '../../lib/text.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type ActorContext, type EventObject } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { EVENT_COLS, OCCUPYING, eventObjects, type EventRow } from '../scheduling/access.js';
import { createEvent } from '../scheduling/events.js';
import { checkRange, computeOccurrences, loadPeriods, loadSeries, manages, orgTimezone, planner } from './plan.js';

/**
 * Nhập bảng phân công từ Excel/CSV (IN-62). Cột = ngày của một Nhịp, dòng = vị trí (khớp tên không dấu),
 * ô = người. Chỉ ghi vào bản nháp: file là chuẩn cho ô có trong file (thêm và bỏ), không ai được báo.
 * Buổi đã gửi bị bỏ qua (Dung chọn 2026-11-22: nhập là bản nháp trước khi gửi lịch chính thức).
 * Xem trước và ghi dùng chung buildPlan nên kết quả ghi đúng như xem trước tại thời điểm ghi.
 */

const MAX_ADD = 1500;

interface PosRow {
  id: string | null;
  event_id: string | null;
  name: string;
  group_id: string | null;
  slots: number;
  sort: number;
}

interface ColumnPlan extends RosterColumnDto {
  endsAt: string;
  definition: TemplateDefinition;
  location: string | null;
  row: EventRow | null;
  obj: EventObject | null;
}

interface Plan {
  tz: string;
  seriesId: string;
  from: string;
  to: string;
  columns: ColumnPlan[];
  cells: Array<Array<RosterCellDto | null>>;
  totals: RosterTotalsDto;
  maxSort: Map<string, number>;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

async function buildPlan(db: Queryable, userId: string, orgId: string, input: RosterImportInput, lock: boolean): Promise<Plan> {
  const actor: ActorContext = await planner(db, userId, orgId);
  const series = (await loadSeries(db, orgId, [input.seriesId]))[0];
  if (!series) throw notFound();
  if (!manages(actor, series.row)) assertAllowed(can(actor, 'event.create', { type: 'event_draft', orgId, groupIds: series.row.definition.groupIds }));

  const names = input.rows.map((r) => normalizeText(r.name));
  const dup = names.findIndex((n, i) => names.indexOf(n) !== i);
  if (dup >= 0) throw new AppError('validation_failed', `Dòng "${input.rows[dup]!.name}" bị lặp`, { fields: { rows: 'duplicate_name' } });

  const tz = await orgTimezone(db, orgId);
  const dates = input.columns.map((c) => c.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  checkRange(from, to);
  const periods = await loadPeriods(db, orgId, addDaysIso(from, -1), addDaysIso(to, 1));
  const occ = await computeOccurrences(db, orgId, tz, [series], periods, from, to);
  const byDate = new Map(occ.map((o) => [o.date, o]));

  const ids = uniq(occ.filter((o) => o.eventId && o.state === 'materialized').map((o) => o.eventId!));
  const evRows = ids.length
    ? (await db.query<EventRow>(`select ${EVENT_COLS} from app.events where id = any($1::uuid[]) and deleted_at is null ${lock ? 'for update' : ''}`, [ids])).rows
    : [];
  const objs = await eventObjects(db, evRows);
  const now = Date.now();
  const seen = new Set<string>();

  const columns: ColumnPlan[] = input.columns.map((c) => {
    const o = byDate.get(c.date);
    const definition = o?.definition ?? series.row.definition;
    const row = o?.eventId ? (evRows.find((e) => e.id === o.eventId) ?? null) : null;
    const startsAt = row ? row.starts_at : c.time ? zonedToUtc(c.date, c.time, tz) : o ? new Date(o.startsAt) : zonedToUtc(c.date, series.row.local_time, tz);
    const endsAt = row ? row.ends_at : new Date(startsAt.getTime() + definition.durationMin * 60_000);
    let state: ColumnPlan['state'];
    if (seen.has(c.date)) state = 'duplicate';
    else if (o?.state === 'skipped') state = 'skipped';
    else if (row?.status === 'cancelled') state = 'cancelled';
    else if (endsAt.getTime() <= now) state = 'past';
    else state = row ? (row.status as 'draft' | 'published') : 'new';
    seen.add(c.date);
    return {
      date: c.date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      title: row?.title ?? o?.title ?? series.row.name,
      eventId: row?.id ?? null,
      state,
      outsideRule: !o,
      conflict: o?.conflict?.label ?? null,
      definition,
      location: series.row.location,
      row,
      obj: row ? (objs.get(row.id) ?? null) : null,
    };
  });

  const live = columns.filter((c) => c.row && c.state === 'draft').map((c) => c.row!.id);
  const positions = live.length
    ? (
        await db.query<PosRow>(
          `select id, event_id, name, group_id, slots, sort from app.positions where event_id = any($1::uuid[]) and removed_at is null
            order by sort, name ${lock ? 'for update' : ''}`,
          [live],
        )
      ).rows
    : [];
  const occupying = live.length
    ? (await db.query<{ position_id: string; user_id: string }>(`select position_id, user_id from app.assignments where event_id = any($1::uuid[]) and status = any($2::text[])`, [live, OCCUPYING])).rows
    : [];
  const maxSort = new Map<string, number>();
  for (const p of positions) maxSort.set(p.event_id!, Math.max(maxSort.get(p.event_id!) ?? -1, p.sort));

  const members = new Set((await db.query<{ user_id: string }>(`select user_id from app.memberships where org_id = $1 and status = 'active'`, [orgId])).rows.map((r) => r.user_id));
  const everyone = uniq(input.rows.flatMap((r) => r.cells.flat())).filter((u) => members.has(u));
  const busyRows = everyone.length
    ? (
        await db.query<{ user_id: string; starts_on: string; ends_on: string }>(
          `select user_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on from app.unavailabilities
            where org_id = $1 and user_id = any($2::uuid[]) and starts_on <= $4 and ends_on >= $3`,
          [orgId, everyone, from, to],
        )
      ).rows
    : [];
  const busyOn = (u: string, date: string) => busyRows.some((b) => b.user_id === u && b.starts_on <= date && b.ends_on >= date);

  const totals: RosterTotalsDto = {
    newEvents: columns.filter((c) => c.state === 'new').length,
    newPositions: 0,
    added: 0,
    removed: 0,
    ignoredColumns: columns.filter((c) => c.state !== 'new' && c.state !== 'draft').length,
    forbiddenCells: 0,
  };

  const cells = input.rows.map((r, ri) =>
    columns.map((col, ci): RosterCellDto | null => {
      if (col.state !== 'new' && col.state !== 'draft') return null;
      const target = uniq(r.cells[ci] ?? []).filter((u) => members.has(u));
      const pool: PosRow[] =
        col.state === 'new'
          ? col.definition.positions.map((p, i) => ({ id: null, event_id: null, name: p.name, group_id: p.groupId, slots: p.slots, sort: i }))
          : positions.filter((p) => p.event_id === col.row!.id);
      const match = pool.find((p) => normalizeText(p.name) === names[ri]);
      if (!match && !target.length) return null;
      const current = match?.id ? occupying.filter((a) => a.position_id === match.id).map((a) => a.user_id) : [];
      const keep = target.filter((u) => current.includes(u));
      const add = target.filter((u) => !current.includes(u));
      const remove = current.filter((u) => !target.includes(u));
      const slotsBefore = match ? match.slots : null;
      const slotsAfter = Math.max(slotsBefore ?? 1, target.length);
      const changes = add.length > 0 || remove.length > 0 || slotsAfter !== slotsBefore;
      // Buổi mới: người nhập sẽ là người phụ trách buổi nên luôn được sửa vị trí.
      const forbidden =
        changes && col.state !== 'new' && !can(actor, 'position.manage', { type: 'position', id: match?.id ?? null, orgId, event: col.obj!, groupId: match?.group_id ?? null }).allowed;
      const cell: RosterCellDto = {
        positionId: match?.id ?? null,
        newPosition: !match,
        slotsBefore,
        slotsAfter,
        keep,
        add,
        remove,
        busy: add.filter((u) => busyOn(u, col.date)),
        forbidden,
      };
      if (forbidden) totals.forbiddenCells++;
      else {
        if (!match) totals.newPositions++;
        totals.added += add.length;
        totals.removed += remove.length;
      }
      return cell;
    }),
  );
  if (totals.added > MAX_ADD) throw new AppError('validation_failed', `Tối đa ${MAX_ADD} lượt xếp người một lần`, { fields: { rows: 'too_many' } });
  return { tz, seriesId: series.row.id, from, to, columns, cells, totals, maxSort };
}

const publicColumn = (c: ColumnPlan): RosterColumnDto => ({
  date: c.date,
  startsAt: c.startsAt,
  title: c.title,
  eventId: c.eventId,
  state: c.state,
  outsideRule: c.outsideRule,
  conflict: c.conflict,
});

export async function previewRoster(db: Queryable, userId: string, orgId: string, input: RosterImportInput): Promise<RosterPreviewDto> {
  const p = await buildPlan(db, userId, orgId, input, false);
  return { timezone: p.tz, columns: p.columns.map(publicColumn), cells: p.cells, totals: p.totals };
}

export async function importRoster(ctx: CommandCtx, orgId: string, input: RosterImportInput): Promise<RosterImportResultDto> {
  const first = await buildPlan(ctx.tx, ctx.user.id, orgId, input, false);
  // 1) Tạo bản nháp cho ngày chưa có buổi (như "Tạo bản nháp"), rồi tính lại trên dữ liệu đã khoá.
  for (const c of first.columns) {
    if (c.state !== 'new') continue;
    await createEvent(ctx, orgId, {
      title: c.title,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      location: c.location,
      definition: c.definition,
      seriesId: first.seriesId,
      occurrenceOn: c.date,
    });
  }
  const p = await buildPlan(ctx.tx, ctx.user.id, orgId, input, true);
  const totals: RosterTotalsDto = { ...p.totals, newEvents: first.totals.newEvents };

  for (const [ri, row] of input.rows.entries()) {
    for (const [ci, col] of p.columns.entries()) {
      const cell = p.cells[ri]![ci];
      if (!cell || cell.forbidden || !col.row) continue;
      const ev = col.row;
      let positionId = cell.positionId;
      // Bản nháp: sự kiện Position/Assignment không báo ai (IN-24), không phát realtime (như positions.ts).
      if (!positionId) {
        const sort = (p.maxSort.get(ev.id) ?? -1) + 1;
        p.maxSort.set(ev.id, sort);
        const ins = await ctx.tx.query<{ id: string }>(
          `insert into app.positions (org_id, event_id, name, group_id, slots, report_offset_min, sort) values ($1, $2, $3, null, $4, 0, $5) returning id`,
          [orgId, ev.id, row.name.trim(), cell.slotsAfter, sort],
        );
        positionId = ins.rows[0]!.id;
        await emit(ctx, {
          orgId,
          verb: 'position.created',
          object: { type: 'position', id: positionId },
          context: { eventId: ev.id },
          payload: { name: row.name.trim(), group_id: null, slots: cell.slotsAfter, report_offset_min: 0 },
        });
      } else if (cell.slotsAfter !== cell.slotsBefore) {
        await ctx.tx.query(`update app.positions set slots = $2, version = version + 1 where id = $1`, [positionId, cell.slotsAfter]);
        await emit(ctx, {
          orgId,
          verb: 'position.updated',
          object: { type: 'position', id: positionId },
          context: { eventId: ev.id },
          payload: { changes: { slots: { before: cell.slotsBefore, after: cell.slotsAfter } } },
        });
      }
      if (cell.remove.length) {
        // Như "bỏ người khỏi bản nháp": Assignment draft → cancelled, không phát sự kiện.
        await ctx.tx.query(
          `update app.assignments set status = 'cancelled', cancel_reason = 'removed', version = version + 1, updated_at = now()
            where position_id = $1 and user_id = any($2::uuid[]) and status = 'draft'`,
          [positionId, cell.remove],
        );
      }
      if (cell.add.length) {
        await ctx.tx.query(
          `insert into app.assignments (org_id, event_id, position_id, user_id, status, requested_by)
           select $1, $2, $3, u, 'draft', $5 from unnest($4::uuid[]) u`,
          [orgId, ev.id, positionId, cell.add, ctx.user.id],
        );
      }
    }
  }

  const eventIds = p.columns.filter((c) => c.row && c.state === 'draft').map((c) => c.row!.id);
  await emit(ctx, {
    orgId,
    verb: 'roster.imported',
    object: { type: 'organization', id: orgId },
    payload: {
      series_id: p.seriesId,
      from: p.from,
      to: p.to,
      event_ids: eventIds,
      new_events: totals.newEvents,
      added: totals.added,
      removed: totals.removed,
    },
  });
  return { totals, eventIds };
}

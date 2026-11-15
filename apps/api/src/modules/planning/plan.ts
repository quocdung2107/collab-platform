import {
  addDaysIso,
  expandRule,
  isLastOfMonth,
  isoDate,
  nthOfMonth,
  utcToZoned,
  variantFor,
  weekdayIso,
  zonedToUtc,
  type EventSeriesDto,
  type MaterializeResultDto,
  type MonthProposalDto,
  type OccurrenceDto,
  type PlanDto,
  type PlanPeriodDto,
  type SeriesImpactDto,
  type SeriesRule,
  type SeriesVariantDto,
  type TemplateDefinition,
  type VariantAction,
  type VariantSelector,
} from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { normalizeText } from '../../lib/text.js';
import { assertAllowed } from '../access/authorize.js';
import { can, type ActorContext } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { ACTIVE, viewEvent } from '../scheduling/access.js';
import { createEvent, updateEvent } from '../scheduling/events.js';
import { relocateEvent, rescheduleEvent } from '../scheduling/lifecycle.js';
import { eventTaskSeeds } from '../scheduling/templates.js';

/**
 * Lập lịch nhiều cấp (AD-32): Giai đoạn (P2), Nhịp và buổi dự kiến (P3), Biến thể và chỗ trùng (P4),
 * sửa Nhịp theo phạm vi (P5). Buổi dự kiến không lưu; chỉ thành dòng `events` khi người lập lịch bấm "Tạo bản nháp".
 */

const MAX_RANGE_DAYS = 400;
const MAX_MATERIALIZE = 200;

// ---------------------------------------------------------------- nạp

interface PeriodRow {
  id: string;
  name: string;
  kind: 'period' | 'special_day';
  starts_on: string;
  ends_on: string;
  color: PlanPeriodDto['color'];
  note: string | null;
  version: number;
}
const PERIOD_COLS = `id, name, kind, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, color, note, version`;
const periodDto = (r: PeriodRow): PlanPeriodDto => ({ id: r.id, name: r.name, kind: r.kind, startsOn: r.starts_on, endsOn: r.ends_on, color: r.color, note: r.note, version: r.version });

interface SeriesRow {
  id: string;
  org_id: string;
  name: string;
  rule: SeriesRule;
  local_time: string;
  starts_on: string;
  until_on: string | null;
  location: string | null;
  definition: TemplateDefinition;
  template_id: string | null;
  version: number;
}
const SERIES_COLS = `id, org_id, name, rule, to_char(local_time, 'HH24:MI') as local_time, to_char(starts_on, 'YYYY-MM-DD') as starts_on,
  to_char(until_on, 'YYYY-MM-DD') as until_on, location, definition, template_id, version`;

interface VariantRow {
  id: string;
  series_id: string;
  selector: VariantSelector;
  action: VariantAction;
  created_at: Date;
}
const variantDto = (v: VariantRow): SeriesVariantDto => ({ id: v.id, selector: v.selector, action: v.action, createdAt: v.created_at.toISOString() });

async function orgTimezone(db: Queryable, orgId: string) {
  return (await db.query<{ timezone: string }>(`select timezone from app.organizations where id = $1`, [orgId])).rows[0]!.timezone;
}

/** Người lập lịch: quản trị hoặc trưởng một nhóm (org.plan.manage). */
async function planner(db: Queryable, userId: string, orgId: string) {
  const { actor } = await viewOrg(db, userId, orgId);
  assertAllowed(can(actor, 'org.plan.manage', { type: 'organization', id: orgId }));
  return actor;
}

const manages = (actor: ActorContext, s: Pick<SeriesRow, 'org_id' | 'definition'>) =>
  can(actor, 'event.create', { type: 'event_draft', orgId: s.org_id, groupIds: s.definition.groupIds }).allowed;

async function loadSeries(db: Queryable, orgId: string, ids?: string[]) {
  const s = await db.query<SeriesRow>(
    `select ${SERIES_COLS} from app.event_series where org_id = $1 and archived_at is null and ($2::uuid[] is null or id = any($2::uuid[])) order by created_at`,
    [orgId, ids ?? null],
  );
  const v = s.rows.length
    ? await db.query<VariantRow>(`select id, series_id, selector, action, created_at from app.series_variants where series_id = any($1::uuid[]) order by created_at`, [
        s.rows.map((x) => x.id),
      ])
    : { rows: [] as VariantRow[] };
  return s.rows.map((row) => ({ row, variants: v.rows.filter((x) => x.series_id === row.id) }));
}

/** Nhịp để sửa: khoá dòng, kiểm tra phiên bản và quyền. */
async function seriesForEdit(ctx: CommandCtx, seriesId: string, expectedVersion?: number) {
  const r = await ctx.tx.query<SeriesRow>(`select ${SERIES_COLS} from app.event_series where id = $1 and archived_at is null for update`, [seriesId]);
  const row = r.rows[0];
  if (!row) throw notFound();
  const actor = await planner(ctx.tx, ctx.user.id, row.org_id);
  if (!manages(actor, row)) assertAllowed(can(actor, 'event.create', { type: 'event_draft', orgId: row.org_id, groupIds: row.definition.groupIds }));
  if (expectedVersion !== undefined && row.version !== expectedVersion) throw new AppError('version_conflict', 'Nhịp đã được người khác sửa');
  return { row, actor };
}

async function loadPeriods(db: Queryable, orgId: string, from: string, to: string) {
  const r = await db.query<PeriodRow>(
    `select ${PERIOD_COLS} from app.plan_periods where org_id = $1 and archived_at is null and starts_on <= $3 and ends_on >= $2 order by starts_on, name`,
    [orgId, from, to],
  );
  return r.rows.map(periodDto);
}

// ---------------------------------------------------------------- tính buổi dự kiến

interface MatRow {
  id: string;
  series_id: string;
  occurrence_on: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  status: 'draft' | 'published' | 'cancelled';
  detached_at: Date | null;
}

/** Tính các buổi của nhịp trong [from, to] (ngày địa phương): dự kiến, bỏ qua, đã tạo; kèm chỗ trùng. */
async function computeOccurrences(
  db: Queryable,
  orgId: string,
  tz: string,
  series: Array<{ row: SeriesRow; variants: VariantRow[] }>,
  periods: PlanPeriodDto[],
  from: string,
  to: string,
) {
  const mat = series.length
    ? await db.query<MatRow>(
        `select id, series_id, to_char(occurrence_on, 'YYYY-MM-DD') as occurrence_on, title, starts_at, ends_at, status, detached_at
           from app.events where series_id = any($1::uuid[]) and occurrence_on between $2 and $3`,
        [series.map((s) => s.row.id), from, to],
      )
    : { rows: [] as MatRow[] };
  // Buổi không thuộc nhịp (buổi lẻ, buổi đặc biệt) trong khoảng: dùng để phát hiện trùng giờ.
  const loose = await db.query<{ title: string; starts_at: Date; ends_at: Date }>(
    `select title, starts_at, ends_at from app.events
      where org_id = $1 and series_id is null and status <> 'cancelled' and starts_at < $3 and ends_at > $2`,
    [orgId, zonedToUtc(from, '00:00', tz), zonedToUtc(addDaysIso(to, 1), '00:00', tz)],
  );
  const special = periods.filter((p) => p.kind === 'special_day');
  const out: Array<OccurrenceDto & { definition: TemplateDefinition; location: string | null; detached: boolean; status: MatRow['status'] | null }> = [];
  for (const { row, variants } of series) {
    const vdto = variants.map(variantDto);
    const dates = new Set(expandRule(row.rule, row.starts_on, row.until_on, from, to));
    const mine = mat.rows.filter((m) => m.series_id === row.id);
    for (const m of mine) dates.add(m.occurrence_on);
    for (const date of [...dates].sort()) {
      const v = variantFor(vdto, date, periods);
      const m = mine.find((x) => x.occurrence_on === date);
      const ov = v?.action.type === 'override' ? v.action : null;
      const def = ov?.definition ?? row.definition;
      const startsAt = m ? m.starts_at : zonedToUtc(date, ov?.localTime ?? row.local_time, tz);
      const endsAt = m ? m.ends_at : new Date(startsAt.getTime() + def.durationMin * 60_000);
      const state = m ? 'materialized' : v?.action.type === 'skip' ? 'skipped' : 'projected';
      let conflict: OccurrenceDto['conflict'] = null;
      if (state !== 'skipped' && m?.status !== 'cancelled' && v?.action.type !== 'keep') {
        const sd = special.find((p) => p.startsOn === date);
        const ov2 = loose.rows.find((e) => e.starts_at < endsAt && e.ends_at > startsAt);
        if (sd) conflict = { reason: 'special_day', label: sd.name };
        else if (ov2) conflict = { reason: 'overlap', label: ov2.title };
      }
      out.push({
        seriesId: row.id,
        date,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        title: m ? m.title : (ov?.title ?? row.name),
        state,
        eventId: m?.id ?? null,
        variantId: v?.id ?? null,
        conflict,
        definition: def,
        location: row.location,
        detached: !!m?.detached_at,
        status: m?.status ?? null,
      });
    }
  }
  return out;
}

function checkRange(from: string, to: string) {
  if (from > to) throw new AppError('validation_failed', 'Khoảng ngày không hợp lệ', { fields: { to: 'before_from' } });
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new AppError('validation_failed', `Khoảng tối đa ${MAX_RANGE_DAYS} ngày`, { fields: { to: 'too_long' } });
}

const toSeriesDto = (actor: ActorContext, s: { row: SeriesRow; variants: VariantRow[] }): EventSeriesDto => ({
  id: s.row.id,
  name: s.row.name,
  rule: s.row.rule,
  localTime: s.row.local_time,
  startsOn: s.row.starts_on,
  untilOn: s.row.until_on,
  location: s.row.location,
  definition: s.row.definition,
  templateId: s.row.template_id,
  version: s.row.version,
  variants: s.variants.map(variantDto),
  canManage: manages(actor, s.row),
});

/** GET kế hoạch: giai đoạn, nhịp (kèm biến thể), buổi của nhịp trong khoảng. */
export async function getPlan(db: Queryable, userId: string, orgId: string, from: string, to: string): Promise<PlanDto> {
  checkRange(from, to);
  const actor = await planner(db, userId, orgId);
  const tz = await orgTimezone(db, orgId);
  const periods = await loadPeriods(db, orgId, addDaysIso(from, -1), addDaysIso(to, 1));
  const series = await loadSeries(db, orgId);
  const occ = await computeOccurrences(db, orgId, tz, series, periods, from, to);
  return {
    timezone: tz,
    canManage: true,
    periods,
    series: series.map((s) => toSeriesDto(actor, s)),
    occurrences: occ.map(({ definition: _d, location: _l, detached: _x, status: _s, ...o }) => o),
  };
}

// ---------------------------------------------------------------- P2: giai đoạn

export interface PeriodInput {
  name: string;
  kind: 'period' | 'special_day';
  startsOn: string;
  endsOn?: string;
  color?: PlanPeriodDto['color'];
  note?: string | null;
}

export async function createPeriod(ctx: CommandCtx, orgId: string, input: PeriodInput) {
  await planner(ctx.tx, ctx.user.id, orgId);
  const endsOn = input.kind === 'special_day' ? input.startsOn : (input.endsOn ?? input.startsOn);
  if (endsOn < input.startsOn) throw new AppError('validation_failed', 'Ngày kết thúc phải từ ngày bắt đầu', { fields: { endsOn: 'before_start' } });
  const r = await ctx.tx.query<PeriodRow>(
    `insert into app.plan_periods (org_id, name, kind, starts_on, ends_on, color, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${PERIOD_COLS}`,
    [orgId, input.name.trim(), input.kind, input.startsOn, endsOn, input.color ?? (input.kind === 'special_day' ? 'gold' : 'green'), input.note ?? null, ctx.user.id],
  );
  const p = periodDto(r.rows[0]!);
  await emit(ctx, { orgId, verb: 'plan_period.created', object: { type: 'plan_period', id: p.id }, payload: { name: p.name, kind: p.kind, starts_on: p.startsOn, ends_on: p.endsOn } });
  return p;
}

export async function updatePeriod(ctx: CommandCtx, periodId: string, input: Partial<PeriodInput> & { expectedVersion: number }) {
  const cur = await ctx.tx.query<PeriodRow & { org_id: string }>(`select org_id, ${PERIOD_COLS} from app.plan_periods where id = $1 and archived_at is null for update`, [periodId]);
  const row = cur.rows[0];
  if (!row) throw notFound();
  await planner(ctx.tx, ctx.user.id, row.org_id);
  if (row.version !== input.expectedVersion) throw new AppError('version_conflict', 'Giai đoạn đã được người khác sửa', { current: periodDto(row) });
  const kind = input.kind ?? row.kind;
  const startsOn = input.startsOn ?? row.starts_on;
  const endsOn = kind === 'special_day' ? startsOn : (input.endsOn ?? row.ends_on);
  if (endsOn < startsOn) throw new AppError('validation_failed', 'Ngày kết thúc phải từ ngày bắt đầu', { fields: { endsOn: 'before_start' } });
  const r = await ctx.tx.query<PeriodRow>(
    `update app.plan_periods set name = $2, kind = $3, starts_on = $4, ends_on = $5, color = $6, note = $7, version = version + 1 where id = $1 returning ${PERIOD_COLS}`,
    [periodId, input.name?.trim() ?? row.name, kind, startsOn, endsOn, input.color ?? row.color, input.note === undefined ? row.note : input.note, ],
  );
  const p = periodDto(r.rows[0]!);
  await emit(ctx, { orgId: row.org_id, verb: 'plan_period.updated', object: { type: 'plan_period', id: periodId }, payload: { name: p.name, starts_on: p.startsOn, ends_on: p.endsOn } });
  return p;
}

export async function archivePeriod(ctx: CommandCtx, periodId: string) {
  const r = await ctx.tx.query<{ org_id: string }>(`select org_id from app.plan_periods where id = $1 and archived_at is null for update`, [periodId]);
  if (!r.rows[0]) throw notFound();
  await planner(ctx.tx, ctx.user.id, r.rows[0].org_id);
  await ctx.tx.query(`update app.plan_periods set archived_at = now(), version = version + 1 where id = $1`, [periodId]);
  await emit(ctx, { orgId: r.rows[0].org_id, verb: 'plan_period.archived', object: { type: 'plan_period', id: periodId } });
  return { id: periodId, archived: true };
}

// ---------------------------------------------------------------- P3: nhịp

export interface SeriesInput {
  name?: string;
  rule: SeriesRule;
  localTime?: string;
  startsOn?: string;
  untilOn?: string | null;
  location?: string | null;
  templateId?: string;
  /** Lấy định nghĩa (thời lượng, nhóm, vị trí, việc) và tên, giờ, ngày bắt đầu từ một buổi có sẵn; buổi đó thành buổi đầu của nhịp. */
  sourceEventId?: string;
}

/** Định nghĩa chụp lại từ một buổi: như "Tạo mẫu từ Event", không lấy người. */
async function definitionFromEvent(db: Queryable, eventId: string, startsAt: Date, endsAt: Date, groupIds: readonly string[]): Promise<TemplateDefinition> {
  const pos = await db.query<{ name: string; group_id: string | null; slots: number; report_offset_min: number }>(
    `select name, group_id, slots, report_offset_min from app.positions where event_id = $1 and removed_at is null order by sort, name`,
    [eventId],
  );
  return {
    durationMin: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
    groupIds: [...groupIds],
    positions: pos.rows.map((p) => ({ name: p.name, groupId: p.group_id, slots: p.slots, reportOffsetMin: p.report_offset_min })),
    tasks: (await eventTaskSeeds(db, eventId, startsAt)).map((t) => ({ title: t.title, dueOffsetMin: t.dueOffsetMin })),
  };
}

function checkRule(rule: SeriesRule) {
  const bad = (f: string) => {
    throw new AppError('validation_failed', 'Quy tắc lặp không hợp lệ', { fields: { [`rule.${f}`]: 'invalid' } });
  };
  if (rule.freq !== 'yearly' && (rule.weekday < 0 || rule.weekday > 6)) bad('weekday');
  if (rule.freq === 'weekly' && (rule.interval < 1 || rule.interval > 8)) bad('interval');
  if (rule.freq === 'monthly' && !(rule.nth === -1 || (rule.nth >= 1 && rule.nth <= 5))) bad('nth');
  if (rule.freq === 'yearly' && (rule.month < 1 || rule.month > 12 || rule.day < 1 || rule.day > 31)) bad('day');
}

export async function createSeries(ctx: CommandCtx, orgId: string, input: SeriesInput): Promise<EventSeriesDto> {
  const actor = await planner(ctx.tx, ctx.user.id, orgId);
  const tz = await orgTimezone(ctx.tx, orgId);
  checkRule(input.rule);
  let name = input.name?.trim();
  let localTime = input.localTime;
  let startsOn = input.startsOn;
  let location = input.location ?? null;
  let definition: TemplateDefinition | null = null;
  let templateId: string | null = null;
  let source: { id: string; date: string; seriesId: string | null } | null = null;

  if (input.sourceEventId) {
    const ev = await viewEvent(ctx.tx, ctx.user.id, input.sourceEventId).catch(() => {
      throw new AppError('validation_failed', 'Buổi nguồn không tồn tại', { fields: { sourceEventId: 'not_found' } });
    });
    if (ev.row.org_id !== orgId) throw new AppError('validation_failed', 'Buổi nguồn không tồn tại', { fields: { sourceEventId: 'not_found' } });
    const local = utcToZoned(ev.row.starts_at, tz);
    definition = await definitionFromEvent(ctx.tx, ev.row.id, ev.row.starts_at, ev.row.ends_at, ev.obj.groupIds);
    templateId = ev.row.template_id;
    name ??= ev.row.title;
    localTime ??= local.time;
    startsOn ??= local.date;
    location = input.location === undefined ? ev.row.location : location;
    source = { id: ev.row.id, date: local.date, seriesId: ev.row.series_id };
  } else if (input.templateId) {
    const t = await ctx.tx.query<{ id: string; name: string; definition: TemplateDefinition }>(
      `select id, name, definition from app.event_templates where id = $1 and org_id = $2 and archived_at is null`,
      [input.templateId, orgId],
    );
    if (!t.rows[0]) throw new AppError('validation_failed', 'Mẫu không tồn tại', { fields: { templateId: 'not_found' } });
    definition = t.rows[0].definition;
    templateId = t.rows[0].id;
    name ??= t.rows[0].name;
  }
  if (!definition) throw new AppError('validation_failed', 'Chọn mẫu hoặc buổi nguồn', { fields: { templateId: 'required' } });
  if (!name) throw new AppError('validation_failed', 'Thiếu tên', { fields: { name: 'required' } });
  if (!localTime) throw new AppError('validation_failed', 'Thiếu giờ', { fields: { localTime: 'required' } });
  if (!startsOn) throw new AppError('validation_failed', 'Thiếu ngày bắt đầu', { fields: { startsOn: 'required' } });
  if (input.untilOn && input.untilOn < startsOn) throw new AppError('validation_failed', 'Ngày kết thúc phải sau ngày bắt đầu', { fields: { untilOn: 'before_start' } });
  assertAllowed(can(actor, 'event.create', { type: 'event_draft', orgId, groupIds: definition.groupIds }));

  const r = await ctx.tx.query<SeriesRow>(
    `insert into app.event_series (org_id, name, rule, local_time, starts_on, until_on, location, definition, template_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${SERIES_COLS}`,
    [orgId, name, JSON.stringify(input.rule), localTime, startsOn, input.untilOn ?? null, location, JSON.stringify(definition), templateId, ctx.user.id],
  );
  const row = r.rows[0]!;
  await emit(ctx, {
    orgId,
    verb: 'series.created',
    object: { type: 'event_series', id: row.id },
    payload: { name, rule: input.rule, local_time: localTime, starts_on: startsOn, until_on: input.untilOn ?? null, source_event_id: source?.id ?? null },
  });
  await linkExisting(ctx, row, tz, source && !source.seriesId ? source.id : null);
  return toSeriesDto(actor, { row, variants: [] });
}

/**
 * Gắn các buổi đã có (chưa thuộc nhịp nào) vào nhịp mới khi trùng ngày của quy tắc, cùng giờ và cùng tên/mẫu,
 * để không hiện thêm buổi dự kiến trùng với buổi thật. Buổi nguồn luôn được gắn.
 */
async function linkExisting(ctx: CommandCtx, s: SeriesRow, tz: string, sourceId: string | null, extraTitles: string[] = []) {
  const until = s.until_on ?? addDaysIso(s.starts_on, MAX_RANGE_DAYS);
  const cands = await ctx.tx.query<{ id: string; title_norm: string; template_id: string | null; starts_at: Date }>(
    `select id, title_norm, template_id, starts_at from app.events
      where org_id = $1 and series_id is null and starts_at >= $2 and starts_at < $3`,
    [s.org_id, zonedToUtc(s.starts_on, '00:00', tz), zonedToUtc(addDaysIso(until, 1), '00:00', tz)],
  );
  const dates = new Set(expandRule(s.rule, s.starts_on, s.until_on, s.starts_on, until));
  const titles = new Set([normalizeText(s.name), ...extraTitles.map(normalizeText)]);
  const used = new Set(
    (await ctx.tx.query<{ d: string }>(`select to_char(occurrence_on, 'YYYY-MM-DD') as d from app.events where series_id = $1`, [s.id])).rows.map((x) => x.d),
  );
  let linked = 0;
  for (const e of cands.rows.sort((a, b) => (a.id === sourceId ? -1 : b.id === sourceId ? 1 : 0))) {
    const local = utcToZoned(e.starts_at, tz);
    const match = e.id === sourceId || (dates.has(local.date) && (titles.has(e.title_norm) || (s.template_id !== null && e.template_id === s.template_id)));
    if (!match || used.has(local.date)) continue;
    await ctx.tx.query(`update app.events set series_id = $2, occurrence_on = $3 where id = $1`, [e.id, s.id, local.date]);
    used.add(local.date);
    linked++;
  }
  return linked;
}

/** "Lặp tuần này" (P3): mỗi buổi chọn thành một nhịp tuần (hoặc quy tắc gửi kèm), tới ngày untilOn. */
export async function seriesFromEvents(ctx: CommandCtx, orgId: string, input: { items: Array<{ eventId: string; rule?: SeriesRule }>; interval?: number; untilOn: string | null }) {
  const tz = await orgTimezone(ctx.tx, orgId);
  const out: EventSeriesDto[] = [];
  for (const it of input.items) {
    const ev = (await ctx.tx.query<{ starts_at: Date }>(`select starts_at from app.events where id = $1 and org_id = $2`, [it.eventId, orgId])).rows[0];
    if (!ev) throw new AppError('validation_failed', 'Buổi nguồn không tồn tại', { fields: { items: 'not_found' } });
    const date = utcToZoned(ev.starts_at, tz).date;
    const rule = it.rule ?? { freq: 'weekly' as const, interval: input.interval ?? 1, weekday: weekdayIso(date) };
    out.push(await createSeries(ctx, orgId, { rule, sourceEventId: it.eventId, untilOn: input.untilOn }));
  }
  return out;
}

export async function archiveSeries(ctx: CommandCtx, seriesId: string) {
  const { row } = await seriesForEdit(ctx, seriesId);
  await ctx.tx.query(`update app.event_series set archived_at = now(), version = version + 1 where id = $1`, [seriesId]);
  await emit(ctx, { orgId: row.org_id, verb: 'series.archived', object: { type: 'event_series', id: seriesId }, payload: { name: row.name } });
  return { id: seriesId, archived: true };
}

/** "Tạo bản nháp" (P3): biến buổi dự kiến trong khoảng thành bản nháp. Chỗ trùng chưa quyết bị bỏ qua trừ khi được chọn đích danh. */
export async function materialize(
  ctx: CommandCtx,
  orgId: string,
  input: { from: string; to: string; seriesIds?: string[]; only?: Array<{ seriesId: string; date: string }> },
): Promise<MaterializeResultDto> {
  checkRange(input.from, input.to);
  const actor = await planner(ctx.tx, ctx.user.id, orgId);
  const tz = await orgTimezone(ctx.tx, orgId);
  const periods = await loadPeriods(ctx.tx, orgId, addDaysIso(input.from, -1), addDaysIso(input.to, 1));
  const series = (await loadSeries(ctx.tx, orgId, input.seriesIds)).filter((s) => manages(actor, s.row));
  const occ = await computeOccurrences(ctx.tx, orgId, tz, series, periods, input.from, input.to);
  const only = input.only ? new Set(input.only.map((o) => `${o.seriesId}|${o.date}`)) : null;
  let skippedConflicts = 0;
  let skippedExisting = 0;
  const todo = occ.filter((o) => {
    if (only && !only.has(`${o.seriesId}|${o.date}`)) return false;
    if (o.state === 'materialized') return (skippedExisting++, false);
    if (o.state !== 'projected') return false;
    if (o.conflict && !only) return (skippedConflicts++, false);
    return new Date(o.endsAt) > new Date();
  });
  if (todo.length > MAX_MATERIALIZE) throw new AppError('validation_failed', `Tối đa ${MAX_MATERIALIZE} buổi một lần; chọn khoảng ngắn hơn`, { fields: { to: 'too_many' } });
  const eventIds: string[] = [];
  for (const o of todo) {
    const r = await createEvent(ctx, orgId, {
      title: o.title,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      location: o.location,
      definition: o.definition,
      seriesId: o.seriesId,
      occurrenceOn: o.date,
    });
    eventIds.push(r.event.id);
  }
  if (eventIds.length) {
    await emit(ctx, { orgId, verb: 'series.materialized', object: { type: 'organization', id: orgId }, payload: { from: input.from, to: input.to, count: eventIds.length } });
  }
  return { created: eventIds.length, skippedExisting, skippedConflicts, eventIds };
}

// ---------------------------------------------------------------- P4: biến thể, lặp tháng

export async function addVariant(ctx: CommandCtx, seriesId: string, input: { selector: VariantSelector; action: VariantAction }) {
  const { row } = await seriesForEdit(ctx, seriesId);
  if (input.selector.kind === 'period') {
    const p = await ctx.tx.query(`select 1 from app.plan_periods where id = $1 and org_id = $2`, [input.selector.periodId, row.org_id]);
    if (!p.rowCount) throw new AppError('validation_failed', 'Giai đoạn không tồn tại', { fields: { 'selector.periodId': 'not_found' } });
  }
  // Mỗi ngày cụ thể chỉ giữ một biến thể: quyết định mới thay quyết định cũ.
  if (input.selector.kind === 'date') {
    await ctx.tx.query(`delete from app.series_variants where series_id = $1 and selector->>'kind' = 'date' and selector->>'date' = $2`, [seriesId, input.selector.date]);
  }
  const r = await ctx.tx.query<VariantRow>(
    `insert into app.series_variants (org_id, series_id, selector, action, created_by) values ($1,$2,$3,$4,$5) returning id, series_id, selector, action, created_at`,
    [row.org_id, seriesId, JSON.stringify(input.selector), JSON.stringify(input.action), ctx.user.id],
  );
  await ctx.tx.query(`update app.event_series set version = version + 1 where id = $1`, [seriesId]);
  await emit(ctx, {
    orgId: row.org_id,
    verb: 'series.variant_added',
    object: { type: 'event_series', id: seriesId },
    payload: { variant_id: r.rows[0]!.id, selector: input.selector, action: { ...input.action, definition: undefined } },
  });
  if (input.action.type === 'override' && input.action.title) await linkExisting(ctx, row, await orgTimezone(ctx.tx, row.org_id), null, [input.action.title]);
  return variantDto(r.rows[0]!);
}

export async function removeVariant(ctx: CommandCtx, variantId: string) {
  const v = await ctx.tx.query<{ series_id: string }>(`select series_id from app.series_variants where id = $1`, [variantId]);
  if (!v.rows[0]) throw notFound();
  const { row } = await seriesForEdit(ctx, v.rows[0].series_id);
  await ctx.tx.query(`delete from app.series_variants where id = $1`, [variantId]);
  await ctx.tx.query(`update app.event_series set version = version + 1 where id = $1`, [row.id]);
  await emit(ctx, { orgId: row.org_id, verb: 'series.variant_removed', object: { type: 'event_series', id: row.id }, payload: { variant_id: variantId } });
  return { id: variantId, removed: true };
}

/** "Lặp tháng này" (P4): đọc tháng nguồn thành nhịp tuần, nhịp "thứ n của tháng", hoặc biến thể của nhịp tuần cùng giờ. */
export async function monthProposals(db: Queryable, userId: string, orgId: string, month: string): Promise<MonthProposalDto[]> {
  await planner(db, userId, orgId);
  const tz = await orgTimezone(db, orgId);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = addDaysIso(isoDate(y, m + 1, 1), -1);
  const evs = await db.query<{ id: string; title: string; title_norm: string; template_id: string | null; starts_at: Date; series_id: string | null }>(
    `select id, title, title_norm, template_id, starts_at, series_id from app.events
      where org_id = $1 and status <> 'cancelled' and starts_at >= $2 and starts_at < $3 order by starts_at`,
    [orgId, zonedToUtc(from, '00:00', tz), zonedToUtc(addDaysIso(to, 1), '00:00', tz)],
  );
  const periods = await loadPeriods(db, orgId, from, to);
  const rows = evs.rows.map((e) => {
    const l = utcToZoned(e.starts_at, tz);
    return { ...e, date: l.date, time: l.time, wd: weekdayIso(l.date), key: `${e.template_id ?? e.title_norm}|${weekdayIso(l.date)}|${l.time}` };
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
  const weekdaysInMonth = (wd: number) => expandRule({ freq: 'weekly', interval: 1, weekday: wd }, from, to, from, to).length;
  const weeklyByWdTime = new Map<string, string>();
  const out: MonthProposalDto[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    if (g.length >= 2 && g.length >= weekdaysInMonth(first.wd) - 1) {
      weeklyByWdTime.set(`${first.wd}|${first.time}`, first.id);
      const covered = g.every((x) => x.series_id);
      out.push({
        eventId: first.id,
        title: first.title,
        startsAt: first.starts_at.toISOString(),
        kind: covered ? 'covered' : 'weekly',
        rule: { freq: 'weekly', interval: 1, weekday: first.wd },
        variantOfEventId: null,
        nth: 0,
        count: g.length,
        note: covered ? 'Đã thuộc một nhịp' : `${g.length} buổi trong tháng: lặp mỗi tuần`,
      });
    }
  }
  for (const g of groups.values()) {
    const first = g[0]!;
    if (out.some((o) => o.eventId === first.id)) continue;
    for (const e of g) {
      const nth = isLastOfMonth(e.date) && nthOfMonth(e.date) >= 4 ? (nthOfMonth(e.date) === 5 ? -1 : nthOfMonth(e.date)) : nthOfMonth(e.date);
      const special = periods.find((p) => p.kind === 'special_day' && p.startsOn === e.date);
      const weekly = weeklyByWdTime.get(`${e.wd}|${e.time}`);
      out.push({
        eventId: e.id,
        title: e.title,
        startsAt: e.starts_at.toISOString(),
        kind: e.series_id ? 'covered' : weekly ? 'variant' : 'monthly',
        rule: { freq: 'monthly', nth, weekday: e.wd },
        variantOfEventId: weekly ?? null,
        nth,
        count: 1,
        note: e.series_id
          ? 'Đã thuộc một nhịp'
          : special
            ? `Rơi vào ngày đặc biệt "${special.name}": thường không lặp`
            : nth === 5 || nth === -1
              ? 'Lần cuối của tháng: tháng không có lần thứ 5 sẽ dùng lần cuối'
              : weekly
                ? `Biến thể của nhịp tuần cùng giờ, lần thứ ${nth} mỗi tháng`
                : `Lần thứ ${nth} của tháng`,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Áp dụng đề xuất "Lặp tháng này": nhịp tuần/tháng trước, rồi biến thể gắn vào nhịp tuần. */
export async function applyMonth(ctx: CommandCtx, orgId: string, input: { items: Array<{ eventId: string; kind: 'weekly' | 'monthly' | 'variant'; rule: SeriesRule; variantOfEventId?: string | null }>; untilOn: string | null }) {
  const created: EventSeriesDto[] = [];
  const variants: SeriesVariantDto[] = [];
  for (const it of input.items.filter((i) => i.kind !== 'variant')) {
    created.push(await createSeries(ctx, orgId, { rule: it.rule, sourceEventId: it.eventId, untilOn: input.untilOn }));
  }
  for (const it of input.items.filter((i) => i.kind === 'variant')) {
    if (!it.variantOfEventId || it.rule.freq !== 'monthly') throw new AppError('validation_failed', 'Biến thể cần nhịp tuần', { fields: { items: 'variant_of' } });
    const host = (await ctx.tx.query<{ series_id: string | null }>(`select series_id from app.events where id = $1 and org_id = $2`, [it.variantOfEventId, orgId])).rows[0]?.series_id;
    if (!host) throw new AppError('validation_failed', 'Nhịp tuần của biến thể chưa có; chọn cả buổi lặp hằng tuần', { fields: { items: 'variant_of' } });
    const ev = await viewEvent(ctx.tx, ctx.user.id, it.eventId);
    const tz = await orgTimezone(ctx.tx, orgId);
    const definition = await definitionFromEvent(ctx.tx, ev.row.id, ev.row.starts_at, ev.row.ends_at, ev.obj.groupIds);
    const v = await addVariant(ctx, host, {
      selector: { kind: 'nth', nth: it.rule.nth },
      action: { type: 'override', title: ev.row.title, localTime: utcToZoned(ev.row.starts_at, tz).time, definition },
    });
    variants.push(v);
    // Buổi nguồn của biến thể cũng thuộc nhịp tuần (cùng ngày, cùng giờ).
    const d = utcToZoned(ev.row.starts_at, tz).date;
    const taken = await ctx.tx.query(`select 1 from app.events where series_id = $1 and occurrence_on = $2`, [host, d]);
    if (!taken.rowCount) await ctx.tx.query(`update app.events set series_id = $2, occurrence_on = $3 where id = $1 and series_id is null`, [ev.row.id, host, d]);
  }
  return { series: created, variants };
}

// ---------------------------------------------------------------- P5: sửa nhịp theo phạm vi

export interface SeriesChange {
  expectedVersion: number;
  /** all: mọi buổi chưa diễn ra; from: từ ngày fromOn (tách nhịp: phần trước giữ nguyên). */
  scope: 'all' | 'from';
  fromOn?: string;
  name?: string;
  localTime?: string;
  durationMin?: number;
  location?: string | null;
  untilOn?: string | null;
}

async function affected(db: Queryable, seriesId: string, fromOn: string) {
  return (
    await db.query<{ id: string; status: 'draft' | 'published' | 'cancelled'; detached_at: Date | null; version: number; starts_at: Date; ends_at: Date; title: string; location: string | null; occurrence_on: string; people: number }>(
      `select e.id, e.status, e.detached_at, e.version, e.starts_at, e.ends_at, e.title, e.location, to_char(e.occurrence_on, 'YYYY-MM-DD') as occurrence_on,
              (select count(distinct a.user_id) from app.assignments a where a.event_id = e.id and a.status = any($3::text[]))::int as people
         from app.events e where e.series_id = $1 and e.occurrence_on >= $2 and e.status <> 'cancelled' order by e.occurrence_on`,
      [seriesId, fromOn, ACTIVE],
    )
  ).rows;
}

const startDate = (tz: string, scope: SeriesChange['scope'], fromOn: string | undefined) => {
  const today = utcToZoned(new Date(), tz).date;
  return scope === 'from' && fromOn && fromOn > today ? fromOn : today;
};

export async function seriesImpact(db: Queryable, userId: string, seriesId: string, input: Omit<SeriesChange, 'expectedVersion'>): Promise<SeriesImpactDto> {
  const s = (await db.query<SeriesRow>(`select ${SERIES_COLS} from app.event_series where id = $1 and archived_at is null`, [seriesId])).rows[0];
  if (!s) throw notFound();
  await planner(db, userId, s.org_id);
  const tz = await orgTimezone(db, s.org_id);
  const from = startDate(tz, input.scope, input.fromOn);
  const evs = await affected(db, seriesId, from);
  const until = input.untilOn ?? s.until_on ?? addDaysIso(from, 365);
  const dates = expandRule(s.rule, s.starts_on, until, from, until).filter((d) => !evs.some((e) => e.occurrence_on === d));
  return {
    projected: dates.length,
    drafts: evs.filter((e) => e.status === 'draft' && !e.detached_at).length,
    detached: evs.filter((e) => e.detached_at).length,
    published: evs.filter((e) => e.status === 'published' && !e.detached_at).length,
    people: evs.filter((e) => e.status === 'published' && !e.detached_at).reduce((n, e) => n + e.people, 0),
  };
}

export async function updateSeries(ctx: CommandCtx, seriesId: string, input: SeriesChange) {
  const { row, actor } = await seriesForEdit(ctx, seriesId, input.expectedVersion);
  const tz = await orgTimezone(ctx.tx, row.org_id);
  const from = startDate(tz, input.scope, input.fromOn);
  const definition = input.durationMin ? { ...row.definition, durationMin: input.durationMin } : row.definition;
  const next = {
    name: input.name?.trim() || row.name,
    local_time: input.localTime ?? row.local_time,
    location: input.location === undefined ? row.location : input.location,
    until_on: input.untilOn === undefined ? row.until_on : input.untilOn,
  };
  let target = row.id;
  if (input.scope === 'from' && from > row.starts_on) {
    // Tách nhịp: phần trước kết thúc hôm trước, phần mới (kèm biến thể) bắt đầu từ ngày chọn.
    const n = await ctx.tx.query<{ id: string }>(
      `insert into app.event_series (org_id, name, rule, local_time, starts_on, until_on, location, definition, template_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [row.org_id, next.name, JSON.stringify(row.rule), next.local_time, from, next.until_on, next.location, JSON.stringify(definition), row.template_id, ctx.user.id],
    );
    target = n.rows[0]!.id;
    await ctx.tx.query(
      `insert into app.series_variants (org_id, series_id, selector, action, created_by, created_at)
       select org_id, $2, selector, action, created_by, created_at from app.series_variants where series_id = $1`,
      [row.id, target],
    );
    await ctx.tx.query(`update app.event_series set until_on = $2, version = version + 1 where id = $1`, [row.id, addDaysIso(from, -1)]);
    await ctx.tx.query(`update app.events set series_id = $2 where series_id = $1 and occurrence_on >= $3`, [row.id, target, from]);
  } else {
    await ctx.tx.query(
      `update app.event_series set name = $2, local_time = $3, location = $4, until_on = $5, definition = $6, version = version + 1 where id = $1`,
      [row.id, next.name, next.local_time, next.location, next.until_on, JSON.stringify(definition)],
    );
  }
  const rootId = await emit(ctx, {
    orgId: row.org_id,
    verb: 'series.updated',
    object: { type: 'event_series', id: target },
    payload: { scope: input.scope, from_on: from, split_from: target !== row.id ? row.id : null, before: { name: row.name, local_time: row.local_time, location: row.location, duration_min: row.definition.durationMin, until_on: row.until_on }, after: { ...next, duration_min: definition.durationMin } },
  });

  // Áp vào buổi đã tạo, chưa sửa riêng. Bản nháp sửa thẳng; buổi đã gửi đi qua Dời lịch / Đổi địa điểm (F7) để báo đúng người.
  const timeChanged = next.local_time !== row.local_time || definition.durationMin !== row.definition.durationMin;
  let applied = 0;
  for (const e of await affected(ctx.tx, target, from)) {
    if (e.detached_at) continue;
    const localTime = timeChanged ? next.local_time : utcToZoned(e.starts_at, tz).time;
    const startsAt = timeChanged ? zonedToUtc(e.occurrence_on, localTime, tz) : e.starts_at;
    const endsAt = timeChanged ? new Date(startsAt.getTime() + definition.durationMin * 60_000) : e.ends_at;
    const moved = startsAt.getTime() !== e.starts_at.getTime() || endsAt.getTime() !== e.ends_at.getTime();
    const titleChanged = next.name !== row.name && e.title === row.name;
    const placeChanged = next.location !== row.location && e.location === row.location;
    if (!moved && !titleChanged && !placeChanged) continue;
    let version = e.version;
    if (e.status === 'draft') {
      await updateEvent(
        ctx,
        e.id,
        {
          expectedVersion: version,
          ...(titleChanged ? { title: next.name } : {}),
          ...(placeChanged ? { location: next.location } : {}),
          ...(moved ? { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } : {}),
        },
        { fromSeries: true },
      );
    } else {
      if (titleChanged) version = (await updateEvent(ctx, e.id, { expectedVersion: version, title: next.name }, { fromSeries: true })).version;
      if (placeChanged) version = (await relocateEvent(ctx, e.id, { expectedVersion: version, location: next.location }, { fromSeries: true })).version;
      if (moved) await rescheduleEvent(ctx, e.id, { expectedVersion: version, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: `Đổi giờ nhịp "${next.name}"` }, { fromSeries: true });
    }
    applied++;
  }
  const s = await loadSeries(ctx.tx, row.org_id, [target]);
  return { series: toSeriesDto(actor, s[0]!), applied, causeId: rootId };
}

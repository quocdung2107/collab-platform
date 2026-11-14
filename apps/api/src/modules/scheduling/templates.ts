import type { EventTemplateDto, TemplateDefinition } from '@collab/shared';
import type { Queryable } from '../../db/pool.js';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import { assertAllowed } from '../access/authorize.js';
import { can } from '../access/can.js';
import { emit } from '../activity/emit.js';
import { viewOrg } from '../identity/organizations.js';
import { viewEvent } from './access.js';

/** Mẫu buổi (EventTemplate). Quản lý: org admin (§4.1 "Quản lý mẫu buổi"). Xem/dùng: thành viên tạo được Event. */

interface Row {
  id: string;
  name: string;
  definition: TemplateDefinition;
  version: number;
}
const toDto = (r: Row): EventTemplateDto => ({ id: r.id, name: r.name, definition: r.definition, version: r.version });

export async function listTemplates(db: Queryable, userId: string, orgId: string) {
  await viewOrg(db, userId, orgId);
  const r = await db.query<Row>(`select id, name, definition, version from app.event_templates where org_id = $1 and archived_at is null order by name`, [orgId]);
  return r.rows.map(toDto);
}

async function insert(ctx: CommandCtx, orgId: string, name: string, def: TemplateDefinition, fromEventId: string | null) {
  const groupIds = [...new Set([...def.groupIds, ...def.positions.map((p) => p.groupId).filter((g): g is string => g !== null)])];
  if (groupIds.length) {
    const g = await ctx.tx.query(`select 1 from app.groups where org_id = $1 and id = any($2::uuid[])`, [orgId, groupIds]);
    if (g.rowCount !== groupIds.length) throw new AppError('validation_failed', 'Nhóm không tồn tại', { fields: { definition: 'group_not_found' } });
  }
  const r = await ctx.tx.query<Row>(
    `insert into app.event_templates (org_id, name, definition, created_by) values ($1, $2, $3, $4) returning id, name, definition, version`,
    [orgId, name.trim(), JSON.stringify(def), ctx.user.id],
  );
  await emit(ctx, {
    orgId,
    verb: 'template.created',
    object: { type: 'event_template', id: r.rows[0]!.id },
    payload: { name: name.trim(), from_event_id: fromEventId },
  });
  return toDto(r.rows[0]!);
}

export async function createTemplate(ctx: CommandCtx, orgId: string, input: { name: string; definition: TemplateDefinition }) {
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, orgId);
  assertAllowed(can(actor, 'org.templates.manage', { type: 'organization', id: orgId }));
  return insert(ctx, orgId, input.name, input.definition, null);
}

/** "Tạo mẫu từ Event" (EVENT_API_CONTRACTS §6): lấy thời lượng, nhóm, Position; không lấy người. */
export async function templateFromEvent(ctx: CommandCtx, eventId: string, name: string) {
  const ev = await viewEvent(ctx.tx, ctx.user.id, eventId);
  assertAllowed(can(ev.actor, 'org.templates.manage', { type: 'organization', id: ev.row.org_id }));
  const pos = await ctx.tx.query<{ name: string; group_id: string | null; slots: number; report_offset_min: number }>(
    `select name, group_id, slots, report_offset_min from app.positions where event_id = $1 and removed_at is null order by sort, name`,
    [eventId],
  );
  const def: TemplateDefinition = {
    durationMin: Math.round((ev.row.ends_at.getTime() - ev.row.starts_at.getTime()) / 60_000),
    groupIds: [...ev.obj.groupIds],
    positions: pos.rows.map((p) => ({ name: p.name, groupId: p.group_id, slots: p.slots, reportOffsetMin: p.report_offset_min })),
    tasks: [],
  };
  return insert(ctx, ev.row.org_id, name, def, eventId);
}

export async function archiveTemplate(ctx: CommandCtx, templateId: string) {
  const r = await ctx.tx.query<{ org_id: string; archived_at: Date | null }>(`select org_id, archived_at from app.event_templates where id = $1 for update`, [
    templateId,
  ]);
  const t = r.rows[0];
  if (!t) throw notFound();
  const { actor } = await viewOrg(ctx.tx, ctx.user.id, t.org_id);
  assertAllowed(can(actor, 'org.templates.manage', { type: 'organization', id: t.org_id }));
  if (!t.archived_at) {
    await ctx.tx.query(`update app.event_templates set archived_at = now(), version = version + 1 where id = $1`, [templateId]);
    await emit(ctx, { orgId: t.org_id, verb: 'template.archived', object: { type: 'event_template', id: templateId } });
  }
  return { id: templateId, archived: true };
}

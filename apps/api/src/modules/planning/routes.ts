import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERIOD_COLORS } from '@collab/shared';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { definitionSchema } from '../scheduling/routes.js';
import {
  addVariant,
  applyMonth,
  archivePeriod,
  archiveSeries,
  createPeriod,
  createSeries,
  getPlan,
  materialize,
  monthProposals,
  removeVariant,
  seriesFromEvents,
  seriesImpact,
  seriesRemoval,
  updatePeriod,
  updateSeries,
} from './plan.js';
import { importRoster, previewRoster } from './roster.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const version = z.number().int().positive();
const weekday = z.number().int().min(0).max(6);
const rule = z.discriminatedUnion('freq', [
  z.object({ freq: z.literal('weekly'), interval: z.number().int().min(1).max(8).default(1), weekday }),
  z.object({ freq: z.literal('monthly'), nth: z.union([z.literal(-1), z.number().int().min(1).max(5)]), weekday }),
  z.object({ freq: z.literal('yearly'), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
]);
const periodFields = {
  name: z.string().trim().min(1, 'Bắt buộc').max(120),
  kind: z.enum(['period', 'special_day']),
  startsOn: day,
  endsOn: day.optional(),
  color: z.enum(PERIOD_COLORS).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
};
const periodBody = z.object(periodFields);
const periodPatch = z.object({ expectedVersion: version, ...z.object(periodFields).partial().shape });
const rangeQuery = z.object({ from: day, to: day });
const seriesBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    rule,
    localTime: time.optional(),
    startsOn: day.optional(),
    untilOn: day.nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    templateId: z.uuid().optional(),
    sourceEventId: z.uuid().optional(),
  })
  .refine((b) => !!b.templateId !== !!b.sourceEventId, { message: 'Chọn mẫu hoặc buổi nguồn', path: ['templateId'] });
const fromEventsBody = z.object({
  items: z.array(z.object({ eventId: z.uuid(), rule: rule.optional() })).min(1).max(30),
  interval: z.number().int().min(1).max(8).optional(),
  untilOn: day.nullable(),
});
const materializeBody = z.object({
  from: day,
  to: day,
  seriesIds: z.array(z.uuid()).max(100).optional(),
  only: z.array(z.object({ seriesId: z.uuid(), date: day })).max(200).optional(),
});
const variantBody = z.object({
  selector: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('date'), date: day }),
    z.object({ kind: z.literal('nth'), nth: z.union([z.literal(-1), z.number().int().min(1).max(5)]) }),
    z.object({ kind: z.literal('period'), periodId: z.uuid() }),
  ]),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('skip') }),
    z.object({ type: z.literal('keep') }),
    z.object({ type: z.literal('override'), title: z.string().trim().min(1).max(200).optional(), localTime: time.optional(), definition: definitionSchema.optional() }),
  ]),
});
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM') });
const fromMonthBody = z.object({
  items: z
    .array(z.object({ eventId: z.uuid(), kind: z.enum(['weekly', 'monthly', 'variant']), rule, variantOfEventId: z.uuid().nullable().optional() }))
    .min(1)
    .max(60),
  untilOn: day.nullable(),
});
const changeFields = {
  scope: z.enum(['all', 'from']),
  fromOn: day.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  localTime: time.optional(),
  durationMin: z.number().int().min(5).max(24 * 60).optional(),
  location: z.string().trim().max(300).nullable().optional(),
  untilOn: day.nullable().optional(),
};
const seriesPatch = z.object({ expectedVersion: version, ...changeFields });
const previewBody = z.object(changeFields);
const archiveBody = z.object({ events: z.enum(['keep', 'all']).default('keep'), reason: z.string().trim().max(500).optional() });

const rosterBody = z
  .object({
    seriesId: z.uuid(),
    columns: z.array(z.object({ date: day, time: time.optional() })).min(1, 'File chưa có cột ngày').max(62, 'Tối đa 62 cột'),
    rows: z
      .array(z.object({ name: z.string().trim().min(1, 'Thiếu tên vị trí').max(120), cells: z.array(z.array(z.uuid()).max(20, 'Tối đa 20 người một ô')) }))
      .min(1, 'File chưa có dòng vị trí')
      .max(100, 'Tối đa 100 dòng'),
  })
  .refine((b) => b.rows.every((r) => r.cells.length === b.columns.length), { message: 'Số ô mỗi dòng phải bằng số cột', path: ['rows'] });

type P = { orgId?: string; periodId?: string; seriesId?: string; variantId?: string };

export async function planningRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };
  const org = (req: { params: P }) => idParam(req.params.orgId);

  app.get<{ Params: P }>('/v1/organizations/:orgId/plan', (req) => {
    const q = parse(rangeQuery, req.query);
    return getPlan(app.db, req.currentUser().id, org(req), q.from, q.to);
  });
  app.post<{ Params: P }>('/v1/organizations/:orgId/plan/materialize', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await materialize(ctx, org(req), parse(materializeBody, req.body)) })),
  );
  // Nhập bảng phân công từ Excel (IN-62): xem trước (chỉ đọc) và ghi.
  app.post<{ Params: P }>('/v1/organizations/:orgId/roster/preview', (req) => previewRoster(app.db, req.currentUser().id, org(req), parse(rosterBody, req.body)));
  app.post<{ Params: P }>('/v1/organizations/:orgId/roster/import', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await importRoster(ctx, org(req), parse(rosterBody, req.body)) })),
  );
  app.get<{ Params: P }>('/v1/organizations/:orgId/plan/month-proposals', (req) =>
    monthProposals(app.db, req.currentUser().id, org(req), parse(monthQuery, req.query).month),
  );

  app.post<{ Params: P }>('/v1/organizations/:orgId/periods', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createPeriod(ctx, org(req), parse(periodBody, req.body)) })),
  );
  app.patch<{ Params: P }>('/v1/periods/:periodId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await updatePeriod(ctx, idParam(req.params.periodId), parse(periodPatch, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/periods/:periodId/archive', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await archivePeriod(ctx, idParam(req.params.periodId)) })),
  );

  app.post<{ Params: P }>('/v1/organizations/:orgId/series', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await createSeries(ctx, org(req), parse(seriesBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/organizations/:orgId/series/from-events', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await seriesFromEvents(ctx, org(req), parse(fromEventsBody, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/organizations/:orgId/series/from-month', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await applyMonth(ctx, org(req), parse(fromMonthBody, req.body)) })),
  );
  app.patch<{ Params: P }>('/v1/series/:seriesId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await updateSeries(ctx, idParam(req.params.seriesId), parse(seriesPatch, req.body)) })),
  );
  app.post<{ Params: P }>('/v1/series/:seriesId/preview', (req) =>
    seriesImpact(app.db, req.currentUser().id, idParam(req.params.seriesId), parse(previewBody, req.body)),
  );
  app.get<{ Params: P }>('/v1/series/:seriesId/removal', (req) => seriesRemoval(app.db, req.currentUser().id, idParam(req.params.seriesId)));
  app.post<{ Params: P }>('/v1/series/:seriesId/archive', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await archiveSeries(ctx, idParam(req.params.seriesId), parse(archiveBody, req.body ?? {})) })),
  );
  app.post<{ Params: P }>('/v1/series/:seriesId/variants', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ status: 201, body: await addVariant(ctx, idParam(req.params.seriesId), parse(variantBody, req.body)) })),
  );
  app.delete<{ Params: P }>('/v1/variants/:variantId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await removeVariant(ctx, idParam(req.params.variantId)) })),
  );
}

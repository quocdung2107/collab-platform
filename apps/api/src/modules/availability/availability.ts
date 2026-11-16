import type { UnavailabilityDto } from '@collab/shared';
import type { CommandCtx } from '../../http/command.js';
import { AppError } from '../../http/errors.js';
import { notFound } from '../../http/validate.js';
import type { Queryable } from '../../db/pool.js';

const MAX_ACTIVE = 100;

type Row = { id: string; org_id: string; starts_on: string; ends_on: string };
const dto = (r: Row): UnavailabilityDto => ({ id: r.id, orgId: r.org_id, startsOn: r.starts_on, endsOn: r.ends_on });
const SELECT = `id, org_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on`;

/** Ngày bận của chính người gọi (từ hôm nay trở đi). Người khác không đọc được danh sách này; người điều phối chỉ nhận cảnh báo lúc xếp (T10). */
export async function listMine(db: Queryable, userId: string, orgId: string): Promise<UnavailabilityDto[]> {
  const r = await db.query<Row>(
    `select ${SELECT} from app.unavailabilities where user_id = $1 and org_id = $2 and ends_on >= current_date - 1 order by starts_on, id`,
    [userId, orgId],
  );
  return r.rows.map(dto);
}

export async function addMine(ctx: CommandCtx, orgId: string, input: { startsOn: string; endsOn: string }): Promise<UnavailabilityDto> {
  if (input.endsOn < input.startsOn) throw new AppError('validation_failed', 'Ngày kết thúc phải sau ngày bắt đầu', { fields: { endsOn: 'before_start' } });
  const m = await ctx.tx.query(`select 1 from app.memberships where org_id = $1 and user_id = $2 and status = 'active'`, [orgId, ctx.user.id]);
  if (!m.rowCount) throw notFound();
  const n = await ctx.tx.query<{ n: string }>(`select count(*) as n from app.unavailabilities where user_id = $1 and org_id = $2 and ends_on >= current_date`, [ctx.user.id, orgId]);
  if (Number(n.rows[0]!.n) >= MAX_ACTIVE) throw new AppError('validation_failed', `Tối đa ${MAX_ACTIVE} khoảng ngày bận`);
  if (new Date(input.endsOn).getTime() - new Date(input.startsOn).getTime() > 365 * 86400_000) throw new AppError('validation_failed', 'Một khoảng bận tối đa 365 ngày', { fields: { endsOn: 'too_long' } });
  const r = await ctx.tx.query<Row>(
    `insert into app.unavailabilities (org_id, user_id, starts_on, ends_on) values ($1, $2, $3, $4) returning ${SELECT}`,
    [orgId, ctx.user.id, input.startsOn, input.endsOn],
  );
  return dto(r.rows[0]!);
}

export async function removeMine(ctx: CommandCtx, id: string): Promise<{ ok: true }> {
  const r = await ctx.tx.query(`delete from app.unavailabilities where id = $1 and user_id = $2`, [id, ctx.user.id]);
  if (!r.rowCount) throw notFound();
  return { ok: true };
}

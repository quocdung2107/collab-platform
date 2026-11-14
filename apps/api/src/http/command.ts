import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTx, type Db, type Tx } from '../db/pool.js';
import type { UserRow } from '../modules/identity/users.js';
import type { RealtimePublisher } from '../modules/realtime/publisher.js';
import { AppError } from './errors.js';

/** Ngữ cảnh của một lệnh ghi: chạy trong một giao dịch, mang danh tính và khoá idempotent. */
export interface CommandCtx {
  tx: Tx;
  user: UserRow;
  requestId: string | null;
  realtime: RealtimePublisher;
}

export interface CommandResult<T> {
  status?: number;
  body: T;
}

/**
 * Chạy lệnh ghi (EVENT_API_CONTRACTS §4):
 * - Toàn bộ thay đổi + activity_events + realtime trong MỘT giao dịch (AD-08).
 * - Idempotency-Key: lặp lại cùng khoá trả kết quả lần đầu, không ghi thêm. Khoá trùng nhưng
 *   nội dung yêu cầu khác → validation_failed. Lệnh lỗi rollback cả khoá, nên gửi lại được.
 */
export async function runCommand<T>(
  deps: { db: Db; realtime: RealtimePublisher },
  req: FastifyRequest,
  reply: FastifyReply,
  fn: (ctx: CommandCtx) => Promise<CommandResult<T>>,
) {
  const user = req.currentUser();
  const key = headerValue(req.headers['idempotency-key']);
  if (key !== null && (key.length < 8 || key.length > 200)) {
    throw new AppError('validation_failed', 'Idempotency-Key phải dài 8–200 ký tự', { fields: { 'Idempotency-Key': 'length' } });
  }
  const requestHash = createHash('sha256')
    .update(`${req.method} ${req.url}\n${JSON.stringify(req.body ?? null)}`)
    .digest('hex');

  const result = await withTx(deps.db, async (tx) => {
    if (key !== null) {
      // Bản ghi khoá được tạo trước; yêu cầu song song cùng khoá sẽ chờ giao dịch này kết thúc.
      const ins = await tx.query(
        `insert into app.idempotency_keys (user_id, key, request_hash) values ($1, $2, $3)
         on conflict (user_id, key) do nothing returning key`,
        [user.id, key, requestHash],
      );
      if (ins.rowCount === 0) {
        const prev = await tx.query<{ request_hash: string; status_code: number | null; response: unknown; fresh: boolean }>(
          `select request_hash, status_code, response, created_at > now() - interval '24 hours' as fresh
             from app.idempotency_keys where user_id = $1 and key = $2`,
          [user.id, key],
        );
        const p = prev.rows[0]!;
        if (p.fresh) {
          if (p.request_hash !== requestHash) {
            throw new AppError('validation_failed', 'Idempotency-Key đã dùng cho yêu cầu khác', {
              fields: { 'Idempotency-Key': 'reused' },
            });
          }
          return { status: p.status_code ?? 200, body: p.response as T, replayed: true };
        }
        // Khoá quá 24 giờ: coi như khoá mới.
        await tx.query(
          `update app.idempotency_keys set request_hash = $3, status_code = null, response = null, created_at = now()
            where user_id = $1 and key = $2`,
          [user.id, key, requestHash],
        );
      }
    }

    const r = await fn({ tx, user, requestId: key, realtime: deps.realtime });
    const status = r.status ?? 200;
    if (key !== null) {
      await tx.query(`update app.idempotency_keys set status_code = $3, response = $4 where user_id = $1 and key = $2`, [
        user.id,
        key,
        status,
        JSON.stringify(r.body ?? null),
      ]);
    }
    return { status, body: r.body, replayed: false };
  });

  if (result.replayed) reply.header('Idempotent-Replayed', 'true');
  return reply.status(result.status).send(result.body);
}

function headerValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

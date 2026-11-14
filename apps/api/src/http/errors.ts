import type { ApiErrorBody, ErrorCode } from '@collab/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  state_conflict: 409,
  invalid_transition: 409,
  position_full: 409,
  duplicate_assignment: 409,
  not_a_member: 422,
  read_only: 409,
  rate_limited: 429,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { fields?: Record<string, string>; current?: unknown } = {},
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, ...err.extra } };
    return reply.status(err.status).send(body);
  }
  if ('validation' in err && err.validation) {
    const body: ApiErrorBody = { error: { code: 'validation_failed', message: err.message } };
    return reply.status(400).send(body);
  }
  req.log.error(err);
  const body: ApiErrorBody = { error: { code: 'internal', message: 'Lỗi máy chủ' } };
  return reply.status(500).send(body);
}

import type { Tx } from '../../db/pool.js';

/**
 * Ghi một sự kiện miền vào activity_events TRONG giao dịch đang mở (AD-08, EVENT_API_CONTRACTS §1.2).
 * Chỉ nhận Tx, không nhận pool, để không thể ghi sự kiện ngoài giao dịch của lệnh.
 */
export interface ActivityInput {
  orgId: string;
  verb: string;
  actor: { type: 'user'; id: string } | { type: 'system' };
  object: { type: string; id: string };
  context?: { eventId?: string; taskId?: string; groupId?: string; conversationId?: string };
  causeId?: string;
  payload?: Record<string, unknown>;
  requestId?: string;
}

export async function recordActivity(tx: Tx, e: ActivityInput): Promise<{ id: string; seq: string }> {
  const r = await tx.query<{ id: string; seq: string }>(
    `insert into app.activity_events
       (org_id, verb, actor_type, actor_id, object_type, object_id,
        event_id, task_id, group_id, conversation_id, cause_id, payload, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id, seq`,
    [
      e.orgId,
      e.verb,
      e.actor.type,
      e.actor.type === 'user' ? e.actor.id : null,
      e.object.type,
      e.object.id,
      e.context?.eventId ?? null,
      e.context?.taskId ?? null,
      e.context?.groupId ?? null,
      e.context?.conversationId ?? null,
      e.causeId ?? null,
      JSON.stringify(e.payload ?? {}),
      e.requestId ?? null,
    ],
  );
  return r.rows[0]!;
}

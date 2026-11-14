import type { Tx } from '../../db/pool.js';

/**
 * Adapter Realtime (AD-29, AD-31). Gửi trong cùng giao dịch với lệnh để chỉ phát khi lệnh commit.
 * Sự kiện chỉ mang định danh, không mang nội dung (AD-10).
 */
export interface RealtimeEvent {
  type: string;
  id: string;
  verb: string;
  activity_id?: string;
}

export interface RealtimePublisher {
  send(tx: Tx, topic: string, event: string, payload: RealtimeEvent): Promise<void>;
}

/** Supabase: realtime.send() ghi vào realtime.messages; kênh riêng (private = true). */
export const supabaseRealtime: RealtimePublisher = {
  async send(tx, topic, event, payload) {
    await tx.query('select realtime.send($1::jsonb, $2, $3, true)', [JSON.stringify(payload), event, topic]);
  },
};

/** Ghi lại trong bộ nhớ: dùng cho kiểm thử và chạy cục bộ không có Supabase. */
export class MemoryRealtime implements RealtimePublisher {
  readonly sent: Array<{ topic: string; event: string; payload: RealtimeEvent }> = [];
  async send(_tx: Tx, topic: string, event: string, payload: RealtimeEvent) {
    this.sent.push({ topic, event, payload });
  }
}

export const topics = {
  user: (userId: string) => `user:${userId}`,
  group: (groupId: string) => `group:${groupId}`,
};

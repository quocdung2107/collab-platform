import type { CommandCtx } from '../../http/command.js';
import type { EventRow } from './access.js';

/**
 * Điểm nối để module Task (S10) tham gia vào dời lịch / huỷ Event trong CÙNG giao dịch
 * (NOTIFICATION_ENGINE §8.5, F7-T4/T5, F7 huỷ), mà Scheduling không phụ thuộc vào Task.
 */
export interface EventLifecycleHooks {
  /** Dời lịch: tính lại due_at của Task có due_offset_min, phát task.due_changed (con của rootId). */
  rescheduled(ctx: CommandCtx, event: EventRow, rootId: string): Promise<{ tasksShifted: number; tasksAbsoluteDue: Array<{ id: string; title: string; dueAt: string }> }>;
  /** Huỷ: Task open → cancelled (con), trả owner của mọi Task chưa xong để báo (event.cancelled payload). */
  cancelled(ctx: CommandCtx, event: EventRow, rootId: string): Promise<{ taskOwnerIds: string[] }>;
}

let hooks: EventLifecycleHooks | null = null;
export const registerEventLifecycleHooks = (h: EventLifecycleHooks) => {
  hooks = h;
};
export const lifecycleHooks = (): EventLifecycleHooks => ({
  rescheduled: (ctx, e, root) => (hooks ? hooks.rescheduled(ctx, e, root) : Promise.resolve({ tasksShifted: 0, tasksAbsoluteDue: [] })),
  cancelled: (ctx, e, root) => (hooks ? hooks.cancelled(ctx, e, root) : Promise.resolve({ taskOwnerIds: [] })),
});

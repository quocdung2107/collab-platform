import webpush from 'web-push';

/** Nội dung đẩy dựng lúc gửi, ngắn, không chứa nội dung tin nhắn hay lý do từ chối (NOTIFICATION_ENGINE phụ lục). */
export interface PushMessage {
  title: string;
  body: string;
  /** Hash route của web (vd. "#event=<id>"). */
  url: string;
  /** Thẻ thay thế trên thiết bị: cùng thẻ → thông báo cũ được cập nhật (thu gọn chat §9). */
  tag: string;
}
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
/** permanent: subscription không còn hợp lệ (404/410) → vô hiệu hoá, không thử lại (§8.6). */
export type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string };

export interface PushSender {
  readonly publicKey: string;
  send(target: PushTarget, msg: PushMessage): Promise<SendResult>;
}

/** Web Push với VAPID (AD-25; thư viện đã dùng trong thử nghiệm OD-17). */
export function webPushSender(publicKey: string, privateKey: string, subject: string): PushSender {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    publicKey,
    async send(t, msg) {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(msg), {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 10_000,
        });
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const error = `${status ?? 'network'}: ${String((e as { body?: string }).body ?? (e as Error).message).slice(0, 300)}`;
        return { ok: false, permanent: status === 404 || status === 410, error };
      }
    },
  };
}

/** Bộ gửi trong bộ nhớ cho kiểm thử: ghi lại mọi lần gửi; có thể giả lập lỗi theo endpoint. */
export class MemoryPushSender implements PushSender {
  readonly publicKey = 'BTestPublicKey';
  sent: Array<{ endpoint: string; msg: PushMessage }> = [];
  /** endpoint → kết quả giả lập (mặc định ok). */
  failures = new Map<string, { permanent: boolean; error: string }>();
  async send(t: PushTarget, msg: PushMessage): Promise<SendResult> {
    const f = this.failures.get(t.endpoint);
    if (f) return { ok: false, ...f };
    this.sent.push({ endpoint: t.endpoint, msg });
    return { ok: true };
  }
}

let current: PushSender | null = null;
/** null = chưa cấu hình VAPID: thiết bị không đăng ký được, không lên lịch delivery. */
export const pushSender = () => current;
export function setPushSender(s: PushSender | null) {
  current = s;
}

/** Đồng hồ cho lịch đẩy; kiểm thử đặt giờ cố định để thử giờ yên lặng. */
let clockFn = () => new Date();
export const pushNow = () => clockFn();
export function setPushClock(fn: (() => Date) | null) {
  clockFn = fn ?? (() => new Date());
}

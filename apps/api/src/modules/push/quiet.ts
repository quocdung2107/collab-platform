/** Giờ yên lặng (NOTIFICATION_ENGINE §8.3, OD-03). Hàm thuần để kiểm thử. */

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Giây trong ngày theo múi giờ tz. */
function localSeconds(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

/** Đang trong giờ yên lặng → thời điểm kết thúc (quiet_end kế tiếp); ngoài giờ → null. Khung qua nửa đêm được hỗ trợ. */
export function quietUntil(now: Date, tz: string, start: string, end: string): Date | null {
  const s = minutes(start) * 60;
  const e = minutes(end) * 60;
  if (s === e) return null;
  const t = localSeconds(now, tz);
  const inside = s < e ? t >= s && t < e : t >= s || t < e;
  if (!inside) return null;
  const delta = (e - t + 86_400) % 86_400;
  return new Date(now.getTime() + delta * 1000);
}

/** Ngoại lệ OD-03(c): action_required mà Event bắt đầu trước quiet_end + 2 giờ → gửi ngay. */
export const QUIET_EXCEPTION_MS = 2 * 3600_000;
export function bypassesQuiet(cls: 'action_required' | 'direct', eventStart: Date | null, quietEnd: Date) {
  return cls === 'action_required' && eventStart !== null && eventStart.getTime() < quietEnd.getTime() + QUIET_EXCEPTION_MS;
}

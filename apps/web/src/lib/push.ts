/**
 * OD-17: thử nghiệm Web Push. Mã thử nghiệm, chưa gắn với tài khoản người dùng;
 * thiết bị được nhận diện bằng một id ngẫu nhiên lưu ở máy.
 */
const PUSH_URL = import.meta.env.VITE_PUSH_SPIKE_URL as string | undefined;
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushConfigured = Boolean(PUSH_URL && VAPID_PUBLIC);

export function isIos(ua = navigator.userAgent) {
  return /iPhone|iPad|iPod/i.test(ua);
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function deviceId(): string {
  const KEY = 'od17-device-id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function call(body: Record<string, unknown>) {
  const res = await fetch(PUSH_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? res.statusText));
  return json;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: quá ${ms / 1000} giây không phản hồi`)), ms))]);
}

/** Trạng thái service worker hiện tại, để chẩn đoán khi nút bật thông báo "không có tác dụng". */
export async function serviceWorkerState(): Promise<string> {
  if (!('serviceWorker' in navigator)) return 'không hỗ trợ';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'chưa đăng ký';
  const w = reg.active ?? reg.waiting ?? reg.installing;
  return `${w?.state ?? 'không có worker'} · scope ${new URL(reg.scope).pathname}`;
}

/**
 * Phải gọi trong một thao tác chạm của người dùng (yêu cầu của iOS).
 * Báo từng bước qua step() và đặt giới hạn thời gian để không treo im lặng.
 */
export async function enablePush(step: (m: string) => void = () => undefined): Promise<string> {
  step(`Xin quyền thông báo (hiện tại: ${Notification.permission})…`);
  const permission = await withTimeout(Notification.requestPermission(), 60_000, 'Xin quyền');
  if (permission !== 'granted') throw new Error(`Quyền thông báo: ${permission}. Mở Cài đặt → Thông báo → Collab để bật lại.`);
  step('Chờ service worker…');
  const reg = await withTimeout(navigator.serviceWorker.ready, 15_000, `Service worker (${await serviceWorkerState()})`);
  step('Đăng ký nhận đẩy với Apple/Google…');
  const sub = await withTimeout(
    (async () =>
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC!) })))(),
    20_000,
    'Đăng ký push',
  );
  step('Gửi đăng ký về máy chủ…');
  await withTimeout(
    call({ action: 'subscribe', deviceId: deviceId(), subscription: sub.toJSON(), ua: navigator.userAgent, standalone: isStandalone() }),
    20_000,
    'Lưu đăng ký',
  );
  return new URL(sub.endpoint).host;
}

export async function sendTest(delaySec: number) {
  return call({ action: 'send', deviceId: deviceId(), delaySec });
}

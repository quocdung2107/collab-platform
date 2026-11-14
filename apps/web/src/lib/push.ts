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

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
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

/** Phải gọi trong một thao tác chạm của người dùng (yêu cầu của iOS). */
export async function enablePush(): Promise<string> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(`Quyền thông báo: ${permission}`);
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC!) }));
  await call({ action: 'subscribe', deviceId: deviceId(), subscription: sub.toJSON(), ua: navigator.userAgent, standalone: isStandalone() });
  return new URL(sub.endpoint).host;
}

export async function sendTest(delaySec: number) {
  return call({ action: 'send', deviceId: deviceId(), delaySec });
}

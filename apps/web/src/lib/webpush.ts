import { api } from './api';
import { isIos, isStandalone, pushSupported, urlBase64ToUint8Array, withTimeout } from './push';

/**
 * Web Push gắn tài khoản (F11b). Khoá công khai lấy từ API (/v1/push/config) để đổi khoá không phải build lại.
 * iPhone/iPad: chỉ nhận đẩy khi đã thêm vào Màn hình chính (NOTIFICATION_ENGINE phụ lục, OD-17).
 */
export type PushState =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'needs_install' }
  | { kind: 'server_disabled' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; endpoint: string };

const platform = (): 'ios' | 'android' | 'desktop' => (isIos() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop');

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((x, i) => x === key[i]);
};

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return { kind: 'needs_install' };
  if (!pushSupported()) return { kind: 'unsupported', reason: 'Trình duyệt này không hỗ trợ thông báo đẩy' };
  const cfg = await api.pushConfig();
  if (!cfg.enabled) return { kind: 'server_disabled' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || !cfg.publicKey || !sameKey(sub, urlBase64ToUint8Array(cfg.publicKey))) return { kind: 'off' };
  const mine = await api.pushDevices();
  return mine.some((d) => d.endpoint === sub.endpoint) ? { kind: 'on', endpoint: sub.endpoint } : { kind: 'off' };
}

/** Gọi trong thao tác chạm của người dùng (yêu cầu của iOS). */
export async function turnOnPush() {
  const cfg = await api.pushConfig();
  if (!cfg.enabled || !cfg.publicKey) throw new Error('Máy chủ chưa bật thông báo đẩy');
  const permission = await withTimeout(Notification.requestPermission(), 60_000, 'Xin quyền');
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép thông báo. Mở Cài đặt của máy → Thông báo → Collab để bật.');
  const reg = await withTimeout(navigator.serviceWorker.ready, 15_000, 'Service worker');
  const key = urlBase64ToUint8Array(cfg.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Đăng ký cũ (vd. từ thử nghiệm OD-17) dùng khoá khác → huỷ rồi đăng ký lại.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20_000, 'Đăng ký push');
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.registerPushDevice({ endpoint: j.endpoint, keys: j.keys, platform: platform(), installedStandalone: isStandalone() });
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.removePushDevice(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

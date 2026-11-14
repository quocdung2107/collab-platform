/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

interface PushData {
  title?: string;
  body?: string;
  /** Hash route (vd. "#task=<id>"), ghép vào scope của ứng dụng. */
  url?: string;
  /** Cùng thẻ → thay thông báo cũ (thu gọn chat theo hội thoại, NOTIFICATION_ENGINE §9). */
  tag?: string;
}

self.addEventListener('push', (event) => {
  const data: PushData = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return { body: event.data?.text() };
    }
  })();

  const tasks: Promise<unknown>[] = [
    self.registration.showNotification(data.title ?? 'Collab', {
      body: data.body ?? '',
      icon: 'icon.svg',
      ...(data.tag ? { tag: data.tag, renotify: true } : {}),
      data: { url: data.url?.startsWith('#') ? self.registration.scope + data.url : (data.url ?? self.registration.scope) },
    } as NotificationOptions),
  ];
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => w.url.startsWith(self.registration.scope));
      // Cửa sổ đang mở → chuyển tới đúng đối tượng (hash route) rồi đưa lên trước.
      return existing ? existing.navigate(url).then((w) => (w ?? existing).focus()) : self.clients.openWindow(url);
    }),
  );
});

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  /** OD-17: id lần gửi để báo nhận và đo độ trễ. */
  logId?: string;
  ackUrl?: string;
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
      data: { url: data.url ?? self.registration.scope },
    }),
  ];
  if (data.logId && data.ackUrl) {
    tasks.push(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) =>
        fetch(data.ackUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ack',
            logId: data.logId,
            receivedAt: new Date().toISOString(),
            appState: wins.some((w) => w.visibilityState === 'visible') ? 'foreground' : wins.length ? 'background' : 'closed',
          }),
        }).catch(() => undefined),
      ),
    );
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => w.url.startsWith(self.registration.scope));
      return existing ? existing.focus() : self.clients.openWindow(url);
    }),
  );
});

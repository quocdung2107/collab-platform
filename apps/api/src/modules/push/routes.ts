import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../http/validate.js';
import { listDevices, registerDevice, unregisterDevice } from './devices.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { pushSender } from './sender.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:MM');
const prefsBody = z.object({
  pushActionRequired: z.boolean(),
  pushDirect: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietStart: hhmm,
  quietEnd: hhmm,
});
const deviceBody = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  platform: z.enum(['ios', 'android', 'desktop', 'web']).default('web'),
  installedStandalone: z.boolean().default(false),
});
const endpointBody = z.object({ endpoint: z.string().min(1).max(1000) });

/** Thiết bị đẩy và Notification Preference (F11b). Không phải sự kiện miền: không ghi ActivityEvent (DATA_MODEL §6). */
export async function pushRoutes(app: FastifyInstance) {
  app.get('/v1/push/config', () => {
    const s = pushSender();
    return { enabled: Boolean(s), publicKey: s?.publicKey ?? null };
  });
  app.get('/v1/push/devices', (req) => listDevices(app.db, req.currentUser().id));
  app.post('/v1/push/devices', async (req, reply) => {
    reply.status(201);
    return registerDevice(app.db, req.currentUser().id, parse(deviceBody, req.body));
  });
  app.post('/v1/push/devices/remove', (req) => unregisterDevice(app.db, req.currentUser().id, parse(endpointBody, req.body).endpoint));
  app.get('/v1/me/notification-preferences', (req) => loadPrefs(app.db, req.currentUser().id));
  app.put('/v1/me/notification-preferences', (req) => savePrefs(app.db, req.currentUser().id, parse(prefsBody, req.body)));
}

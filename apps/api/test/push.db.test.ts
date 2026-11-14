import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setPushClock } from '../src/modules/push/sender.js';
import { quietUntil } from '../src/modules/push/quiet.js';
import { allowedEndpoint } from '../src/modules/push/devices.js';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

describe('Giờ yên lặng (hàm thuần)', () => {
  const tz = 'Asia/Ho_Chi_Minh';
  it('22:00–06:30 qua nửa đêm', () => {
    expect(quietUntil(new Date('2034-01-10T03:00:00Z'), tz, '22:00', '06:30')).toBeNull(); // 10:00
    expect(quietUntil(new Date('2034-01-10T16:00:00Z'), tz, '22:00', '06:30')?.toISOString()).toBe('2034-01-10T23:30:00.000Z'); // 23:00 → 06:30
    expect(quietUntil(new Date('2034-01-10T20:00:00Z'), tz, '22:00', '06:30')?.toISOString()).toBe('2034-01-10T23:30:00.000Z'); // 03:00
    expect(quietUntil(new Date('2034-01-10T23:30:00Z'), tz, '22:00', '06:30')).toBeNull(); // đúng 06:30
  });
  it('endpoint chỉ của dịch vụ đẩy đã biết (chặn SSRF)', () => {
    expect(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(allowedEndpoint('https://web.push.apple.com/QABC')).toBe(true);
    expect(allowedEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(allowedEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(allowedEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
  });
});

/** S12 — Kênh đẩy (F11b): N5, N8, N9, F11-T6..T11, chat §9. */
describe.skipIf(!TEST_DB_URL)('F11b: đẩy thông báo', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, M3: TestUser;
  let orgId: string, sound: string;
  // Giờ VN = UTC+7. 10:00 VN ngày d = 03:00 UTC.
  const vn = (d: number, hour: number, min = 0) => new Date(Date.UTC(2034, 0, d, hour - 7, min));
  let clock = vn(5, 10);
  const setClock = (d: Date) => (clock = d);
  const later = (ms: number) => setClock(new Date(clock.getTime() + ms));
  let devN = 0;
  /** Thiết bị đăng ký trong kiểm thử hiện tại (delivery của kiểm thử trước bị bỏ qua). */
  let current: string[] = [];
  const device = async (u: TestUser) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${u.name}-${++devN}`;
    const r = await u.call('POST', '/v1/push/devices', { endpoint, keys: { p256dh: 'BKeyKeyKeyKeyKeyKey', auth: 'authauthauth' }, platform: 'android' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    current.push(endpoint);
    return endpoint;
  };
  const deliveries = async (u: TestUser) =>
    (
      await h.db.query(
        `select d.kind, d.status, d.attempts, d.quiet_deferred, d.not_before, d.last_error, s.endpoint
           from app.notification_deliveries d join app.push_subscriptions s on s.id = d.subscription_id where d.user_id = $1 and s.endpoint = any($2::text[]) order by d.created_at`,
        [u.id, current],
      )
    ).rows;
  const sentTo = (endpoint: string) => h.push.sent.filter((s) => s.endpoint === endpoint);
  const groupTask = async (by: TestUser, body: Record<string, unknown> = {}) => {
    const r = await by.call('POST', '/v1/tasks', { title: 'Chuẩn bị micro', scope: { type: 'group', groupId: sound }, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const clearDeliveries = async () => {
    await h.db.query(`update app.notification_deliveries set status = 'cancelled' where status = 'scheduled'`);
    h.push.sent = [];
  };

  beforeAll(async () => {
    setPushClock(() => clock);
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    orgId = (await AD.call('POST', `/v1/organizations`, { name: 'Hội thánh' })).body.id;
    await AD.call('PATCH', `/v1/organizations/${orgId}`, { timezone: 'Asia/Ho_Chi_Minh' });
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, M1, M2, M3]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
      await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    }
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });
    await h.dispatch();
  });
  afterEach(async () => {
    await clearDeliveries();
    await h.db.query(`delete from app.notification_preferences`);
    await h.db.query(`update app.push_subscriptions set disabled_at = now(), disabled_reason = 'unsubscribed' where disabled_at is null`);
    await h.db.query(`delete from app.subscriptions where target_type = 'conversation'`);
    h.push.failures.clear();
    current = [];
    setClock(vn(5, 10));
  });
  afterAll(async () => {
    setPushClock(null);
    await h?.close();
  });

  it('cấu hình và đăng ký thiết bị: endpoint lạ bị từ chối', async () => {
    expect((await M2.call('GET', '/v1/push/config')).body).toEqual({ enabled: true, publicKey: 'BTestPublicKey' });
    const bad = await M2.call('POST', '/v1/push/devices', { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'BKeyKeyKeyKeyKey', auth: 'authauthauth' } });
    expect(bad.status).toBe(400);
    const ep = await device(M2);
    expect((await M2.call('GET', '/v1/push/devices')).body).toEqual([expect.objectContaining({ endpoint: ep, platform: 'android' })]);
    expect((await M2.call('POST', '/v1/push/devices/remove', { endpoint: ep })).body).toEqual({ removed: true });
    expect((await M2.call('GET', '/v1/push/devices')).body).toEqual([]);
  });

  it('debounce 30 s cho "Cần bạn"; nội dung dựng lúc gửi; xử lý lại sự kiện không thêm delivery (N8, F11-T3)', async () => {
    const ep = await device(M2);
    const t = await groupTask(LD, { ownerId: M2.id });
    await h.dispatch();
    expect(await deliveries(M2)).toEqual([expect.objectContaining({ kind: 'notification', status: 'scheduled', quiet_deferred: false })]);
    later(10_000);
    expect(await h.deliver()).toBe(0);
    later(25_000);
    await h.deliver();
    expect(sentTo(ep)).toEqual([{ endpoint: ep, msg: { title: 'Cần bạn · Chuẩn bị micro', body: 'LD giao việc cho bạn', url: `#task=${t.id}`, tag: expect.stringMatching(/^n:/) } }]);
    // Chạy lại notifier trên cùng sự kiện ba lần.
    for (let i = 0; i < 3; i++) {
      await h.db.query(`update app.activity_events set dispatched_at = null where object_id = $1`, [t.id]);
      await h.dispatch();
    }
    later(200_000);
    await h.deliver();
    expect(await deliveries(M2)).toEqual([expect.objectContaining({ status: 'sent', attempts: 1 })]);
    expect(sentTo(ep)).toHaveLength(1);
  });

  it('F11-T6 (N5): tắt cả hai công tắc → bản ghi và My Workspace đủ, không delivery nào', async () => {
    await device(M2);
    const p = await M2.call('PUT', '/v1/me/notification-preferences', { pushActionRequired: false, pushDirect: false, quietHoursEnabled: true, quietStart: '22:00', quietEnd: '06:30' });
    expect(p.body).toMatchObject({ pushActionRequired: false, pushDirect: false });
    const t = await groupTask(M1, { ownerId: M2.id });
    await h.dispatch();
    expect((await h.db.query(`select class from app.notifications where user_id = $1 and object_id = $2`, [M2.id, t.id])).rows).toEqual([{ class: 'action_required' }]);
    expect((await M2.call('GET', '/v1/me/workspace')).body.needsResponse.some((x: { id: string }) => x.id === t.id)).toBe(true);
    expect(await deliveries(M2)).toEqual([]);
  });

  it('F11-T10: đọc bản ghi trong lúc delivery đang chờ → skipped', async () => {
    const ep = await device(M2);
    const t = await groupTask(M1, { ownerId: M2.id, requiresAcceptance: false });
    await h.dispatch();
    // Task giao không cần nhận (người giao là thành viên thường → buộc cần nhận); trả lời nhận → bản ghi done.
    await M2.call('POST', `/v1/tasks/${t.id}/respond`, { response: 'accept' });
    await h.dispatch();
    later(60_000);
    await h.deliver();
    expect(await deliveries(M2)).toEqual([expect.objectContaining({ status: 'skipped', last_error: 'resolved' })]);
    expect(sentTo(ep)).toEqual([]);
  });

  it('F11-T8: subscription hỏng → failed, vô hiệu hoá, không thử lại; thiết bị khác vẫn nhận', async () => {
    const bad = await device(M2);
    const good = await device(M2);
    h.push.failures.set(bad, { permanent: true, error: '410: gone' });
    await groupTask(LD, { ownerId: M2.id });
    await h.dispatch();
    later(31_000);
    await h.deliver();
    const ds = await deliveries(M2);
    expect(ds.find((d) => d.endpoint === bad)).toMatchObject({ status: 'failed', last_error: '410: gone' });
    expect(ds.find((d) => d.endpoint === good)).toMatchObject({ status: 'sent' });
    expect(sentTo(good)).toHaveLength(1);
    expect((await M2.call('GET', '/v1/push/devices')).body.map((d: { endpoint: string }) => d.endpoint)).toEqual([good]);
    later(3600_000);
    expect(await h.deliver()).toBe(0);
  });

  it('F11-T9: lỗi tạm thời → thử lại sau 1, 5, 30 phút; quá số lần → failed; bản ghi không đổi', async () => {
    const ep = await device(M2);
    h.push.failures.set(ep, { permanent: false, error: '503: busy' });
    const t = await groupTask(LD, { ownerId: M2.id });
    await h.dispatch();
    later(31_000);
    await h.deliver();
    expect((await deliveries(M2))[0]).toMatchObject({ status: 'scheduled', attempts: 1 });
    for (const [wait, attempts] of [
      [60_000, 2],
      [5 * 60_000, 3],
    ] as const) {
      later(wait - 1000);
      expect(await h.deliver()).toBe(0);
      later(1000);
      await h.deliver();
      expect((await deliveries(M2))[0]).toMatchObject({ status: 'scheduled', attempts });
    }
    later(30 * 60_000);
    await h.deliver();
    expect((await deliveries(M2))[0]).toMatchObject({ status: 'failed', attempts: 4, last_error: '503: busy' });
    expect((await h.db.query(`select action_state from app.notifications where user_id = $1 and object_id = $2`, [M2.id, t.id])).rows).toEqual([{ action_state: 'pending' }]);
  });

  it('F11-T7 (N9): giờ yên lặng → bản ghi tạo ngay, không đẩy tới 06:30; rồi một thông báo tổng hợp', async () => {
    const ep = await device(M2);
    setClock(vn(6, 23));
    const t1 = await groupTask(LD, { ownerId: M2.id, title: 'Việc 1' });
    await groupTask(M1, { ownerId: M2.id, title: 'Việc 2' });
    const t3 = await groupTask(LD, { title: 'Việc 3' });
    await LD.call('POST', `/v1/tasks/${t3.id}/collaborators`, { add: [M2.id] });
    await h.dispatch();
    expect((await h.db.query(`select count(*)::int as n from app.notifications where user_id = $1 and object_id = any($2::uuid[])`, [M2.id, [t1.id, t3.id]])).rows[0].n).toBe(2);
    const ds = await deliveries(M2);
    expect(ds).toHaveLength(3);
    expect(ds.every((d) => d.quiet_deferred && d.not_before.toISOString() === vn(7, 6, 30).toISOString())).toBe(true);
    setClock(vn(7, 3));
    expect(await h.deliver()).toBe(0);
    expect(h.push.sent).toEqual([]);
    setClock(vn(7, 6, 31));
    await h.deliver();
    expect(sentTo(ep)).toEqual([{ endpoint: ep, msg: expect.objectContaining({ title: 'Trong lúc bạn nghỉ', body: '2 việc cần bạn, 1 cập nhật', tag: 'quiet-summary' }) }]);
    expect((await deliveries(M2)).every((d) => d.status === 'sent')).toBe(true);
  });

  it('ngoại lệ OD-03(c): "Cần bạn" cho buổi bắt đầu trước 06:30 + 2 giờ → gửi ngay trong giờ yên lặng', async () => {
    const ep = await device(M2);
    setClock(vn(8, 23));
    const mk = async (startHour: number) => {
      const ev = (await LD.call('POST', `/v1/organizations/${orgId}/events`, { title: `Buổi ${startHour}h`, startsAt: vn(9, startHour).toISOString(), endsAt: vn(9, startHour + 1).toISOString(), groupIds: [sound], visibility: 'org' })).body.event;
      const pos = (await LD.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1 })).body.positions[0];
      await LD.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: M2.id });
      const v = (await LD.call('GET', `/v1/events/${ev.id}`)).body.version;
      expect((await LD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: v })).status).toBe(200);
      return ev.id as string;
    };
    await mk(7); // 07:00 < 08:30 → ngoại lệ
    await mk(10); // 10:00 → hoãn
    await h.dispatch();
    const ds = await deliveries(M2);
    expect(ds.map((d) => d.quiet_deferred)).toEqual([false, true]);
    later(31_000);
    await h.deliver();
    expect(sentTo(ep)).toEqual([{ endpoint: ep, msg: expect.objectContaining({ title: 'Cần bạn · Buổi 7h' }) }]);
  });

  it('chat §9: nhiều tin → một thông báo thu gọn; người đã đọc/mentions/mute không bị đẩy; mention trong hội thoại mute không đẩy', async () => {
    const e2 = await device(M2);
    const e3 = await device(M3);
    const eL = await device(LD);
    const conv = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body;
    const send = (u: TestUser, body: string, mentionIds: string[] = []) =>
      u.call('POST', `/v1/conversations/${conv.id}/messages`, { clientMsgId: `m-${Math.random().toString(36).slice(2, 12)}`, body, mentionIds });
    await M3.call('PUT', `/v1/subscriptions/conversation/${conv.id}`, { mode: 'mentions' });
    await LD.call('PUT', `/v1/subscriptions/conversation/${conv.id}`, { mode: 'mute' });
    await send(M1, 'Chào cả nhà');
    await send(M1, 'Mai tập 7h');
    const last = (await send(M1, '@LD nhớ mang dây', [LD.id])).body;
    await h.dispatch();
    expect((await deliveries(M2)).filter((d) => d.kind === 'chat')).toHaveLength(1);
    expect(await deliveries(M3)).toEqual([]);
    expect(await deliveries(LD)).toEqual([]); // mute: mention vào hộp thông báo, không đẩy
    expect((await h.db.query(`select count(*)::int as n from app.notifications where user_id = $1 and object_type = 'message'`, [LD.id])).rows[0].n).toBe(1);
    later(16_000);
    await h.deliver();
    expect(sentTo(e2)).toEqual([{ endpoint: e2, msg: { title: 'Ban Âm thanh', body: '3 tin mới · mới nhất từ M1', url: `#group=${sound}`, tag: `c:${conv.id}` } }]);
    expect(sentTo(e3)).toEqual([]);
    expect(sentTo(eL)).toEqual([]);
    // M2 đọc tới tin cuối trước khi delivery kế gửi → skipped.
    await send(M1, 'Ai mang loa?');
    await h.dispatch();
    await M2.call('POST', `/v1/conversations/${conv.id}/read`, { seq: last.seq + 1 });
    later(16_000);
    await h.deliver();
    expect((await deliveries(M2)).find((d) => d.kind === 'chat')).toMatchObject({ status: 'skipped', last_error: 'read' });
  });

  it('F11-T11 (N3): mất quyền xem trước khi gửi → skipped', async () => {
    const ep = await device(M3);
    const conv = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body;
    await M1.call('POST', `/v1/conversations/${conv.id}/messages`, { clientMsgId: 'm-lost-access', body: 'Tin nội bộ' });
    await h.dispatch();
    expect(await deliveries(M3)).toHaveLength(1);
    await AD.call('DELETE', `/v1/groups/${sound}/members/${M3.id}`);
    later(16_000);
    await h.deliver();
    expect(await deliveries(M3)).toEqual([expect.objectContaining({ status: 'skipped', last_error: 'no_access' })]);
    expect(sentTo(ep)).toEqual([]);
  });
});

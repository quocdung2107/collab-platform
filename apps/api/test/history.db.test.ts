import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S13 — Lịch sử (F13-T2..T5) và quét truy cập chéo (F14-T1, T2). */
describe.skipIf(!TEST_DB_URL)('F13/F14: lịch sử và truy cập chéo', () => {
  let h: Harness;
  let AD: TestUser, OW: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, X: TestUser, Z: TestUser;
  let orgId: string, otherOrg: string, sound: string, eventId: string, privTask: string, convId: string;
  const at = (d: number, hour: number) => new Date(Date.UTC(2034, 2, d, hour)).toISOString();
  const activityCount = async () => Number((await h.db.query(`select count(*) as n from app.activity_events`)).rows[0].n);

  beforeAll(async () => {
    h = await createHarness();
    [AD, OW, LD, M1, M2, X, Z] = (await Promise.all(['AD', 'OW', 'LD', 'M1', 'M2', 'X', 'Z'].map((n) => h.user(n)))) as TestUser[] as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    otherOrg = (await Z.call('POST', '/v1/organizations', { name: 'Tổ chức khác' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [OW, LD, M1, M2, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [LD, M1, M2]) await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });

    // Buổi chỉ nhóm Âm thanh xem được; OW phụ trách; xếp M1, M2 rồi công bố.
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', startsAt: at(5, 1), endsAt: at(5, 3), groupIds: [sound], visibility: 'groups' })).body.event;
    eventId = ev.id;
    await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id], remove: [AD.id] });
    const pos = (await OW.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 2 })).body.positions[0];
    for (const u of [M1, M2]) await OW.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: u.id });
    await OW.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: (await OW.call('GET', `/v1/events/${ev.id}`)).body.version });
    const asg = async (u: TestUser) => (await h.db.query(`select id from app.assignments where event_id = $1 and user_id = $2`, [ev.id, u.id])).rows[0].id;
    expect((await OW.call('POST', `/v1/assignments/${await asg(M1)}/respond`, { response: 'accept' })).status).toBe(200); // trả lời hộ
    expect((await M2.call('POST', `/v1/assignments/${await asg(M2)}/respond`, { response: 'decline', reason: 'Bận việc nhà' })).status).toBe(200);
    const v = (await OW.call('GET', `/v1/events/${ev.id}`)).body.version;
    expect((await OW.call('POST', `/v1/events/${ev.id}/reschedule`, { expectedVersion: v, startsAt: at(5, 2), endsAt: at(5, 4) })).status).toBe(200);

    privTask = (await M1.call('POST', '/v1/tasks', { orgId, title: 'Việc riêng', scope: { type: 'private' } })).body.id;
    convId = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body.id;
    await h.dispatch();
  });
  afterAll(async () => h?.close());

  it('F13-T3, F13-T5: dời lịch hiện ai đổi, từ mấy giờ sang mấy giờ; hệ quả lồng bên dưới', async () => {
    const hist = (await OW.call('GET', `/v1/events/${eventId}/history`)).body;
    const r = hist[0];
    expect(r).toMatchObject({ verb: 'event.rescheduled', actor: { displayName: 'OW' }, text: 'Dời giờ' });
    expect(r.changes[0]).toEqual({ field: 'giờ bắt đầu', before: expect.stringContaining('08:00'), after: expect.stringContaining('09:00') });
    expect(r.consequences.map((c: { verb: string }) => c.verb)).toContain('assignment.reconfirm_requested');
    expect(r.consequences[0].text).toBe('M1 cần xác nhận lại Âm thanh');
  });

  it('F13-T4: trả lời hộ ghi cả người thực hiện và người được trả lời thay', async () => {
    const hist = (await OW.call('GET', `/v1/events/${eventId}/history`)).body;
    expect(hist.find((x: { verb: string }) => x.verb === 'assignment.accepted')).toMatchObject({ actor: { displayName: 'OW' }, text: 'M1 nhận Âm thanh (do OW trả lời thay)' });
  });

  it('X8: lý do từ chối chỉ người quản lý vị trí và người từ chối thấy; bản nháp chỉ người quản lý thấy', async () => {
    const decline = async (u: TestUser) => (await u.call('GET', `/v1/events/${eventId}/history`)).body.find((x: { verb: string }) => x.verb === 'assignment.declined').text;
    expect(await decline(LD)).toBe('M2 từ chối Âm thanh: "Bận việc nhà"');
    expect(await decline(M2)).toBe('M2 từ chối Âm thanh: "Bận việc nhà"');
    expect(await decline(M1)).toBe('M2 từ chối Âm thanh');
    const verbs = async (u: TestUser) => (await u.call('GET', `/v1/events/${eventId}/history`)).body.map((x: { verb: string }) => x.verb);
    expect(await verbs(OW)).toContain('position.created');
    expect(await verbs(M1)).not.toContain('position.created');
    expect(await verbs(M1)).toContain('event.published');
  });

  it('F13-T2: lệnh thất bại (quyền, xung đột) không ghi dòng nào', async () => {
    const before = await activityCount();
    const v = (await OW.call('GET', `/v1/events/${eventId}`)).body.version;
    expect((await M1.call('POST', `/v1/events/${eventId}/reschedule`, { expectedVersion: v, startsAt: at(5, 5), endsAt: at(5, 6) })).status).toBe(403);
    expect((await OW.call('POST', `/v1/events/${eventId}/reschedule`, { expectedVersion: v - 1, startsAt: at(5, 5), endsAt: at(5, 6) })).status).toBe(409);
    expect((await M1.call('PATCH', `/v1/tasks/${privTask}`, { expectedVersion: 99, title: 'x' })).status).toBe(409);
    expect(await activityCount()).toBe(before);
  });

  it('lịch sử Task: tạo, giao, đổi tiến độ', async () => {
    const t = (await M1.call('POST', '/v1/tasks', { title: 'Kiểm tra micro', scope: { type: 'group', groupId: sound } })).body;
    await M1.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: t.version, status: 'in_progress' });
    const hist = (await LD.call('GET', `/v1/tasks/${t.id}/history`)).body;
    expect(hist.map((x: { text: string }) => x.text)).toEqual(['Đổi tiến độ', 'Tạo việc "Kiểm tra micro"']);
    expect(hist[0].changes).toEqual([{ field: 'tiến độ', before: 'chưa làm', after: 'đang làm' }]);
  });

  it('F14-T1, T2: mọi điểm cuối đọc → not_found giống hệt đối tượng không tồn tại', async () => {
    const ghost = randomUUID();
    const reads: Array<[TestUser, (id: string) => string, string]> = [
      // X cùng tổ chức nhưng ngoài nhóm: buổi visibility = groups, việc riêng của M1.
      [X, (id) => `/v1/events/${id}`, eventId],
      [X, (id) => `/v1/events/${id}/history`, eventId],
      [X, (id) => `/v1/events/${id}/tasks`, eventId],
      [X, (id) => `/v1/events/${id}/related`, eventId],
      [X, (id) => `/v1/events/${id}/attachments`, eventId],
      [X, (id) => `/v1/tasks/${id}`, privTask],
      [X, (id) => `/v1/tasks/${id}/history`, privTask],
      [X, (id) => `/v1/tasks/${id}/related`, privTask],
      [X, (id) => `/v1/tasks/${id}/attachments`, privTask],
      [X, (id) => `/v1/subscriptions/event/${id}`, eventId],
      // Z ở tổ chức khác.
      [Z, (id) => `/v1/organizations/${id}`, orgId],
      [Z, (id) => `/v1/organizations/${id}/members`, orgId],
      [Z, (id) => `/v1/organizations/${id}/groups`, orgId],
      [Z, (id) => `/v1/organizations/${id}/events?from=2034-03-01T00:00:00Z&to=2034-03-30T00:00:00Z`, orgId],
      [Z, (id) => `/v1/organizations/${id}/templates`, orgId],
      [Z, (id) => `/v1/organizations/${id}/conversations`, orgId],
      [Z, (id) => `/v1/groups/${id}`, sound],
      [Z, (id) => `/v1/groups/${id}/conversation`, sound],
      [Z, (id) => `/v1/groups/${id}/tasks`, sound],
      [Z, (id) => `/v1/conversations/${id}/messages`, convId],
      [Z, (id) => `/v1/events/${id}`, eventId],
      [Z, (id) => `/v1/tasks/${id}`, privTask],
    ];
    for (const [u, url, id] of reads) {
      const real = await u.call('GET', url(id));
      const none = await u.call('GET', url(ghost));
      expect([url(':id'), real.status], JSON.stringify(real.body)).toEqual([url(':id'), 404]);
      expect(real.body, url(':id')).toEqual(none.body);
    }
    expect(otherOrg).toBeTruthy();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S11b — tệp đính kèm (F9b, PERMISSION_MODEL §4.7, F14-T4). */
describe.skipIf(!TEST_DB_URL)('F9b: tệp', () => {
  let h: Harness;
  let AD: TestUser, M1: TestUser, M2: TestUser, X: TestUser;
  let orgId: string, A: string, convA: string;
  let n = 0;
  const upload = async (u: TestUser, name = 'bài hát.pdf', size = 1000) => {
    const r = await u.call('POST', `/v1/organizations/${orgId}/uploads`, { filename: name, size });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    h.storage.put(r.body.key, size, 'application/pdf');
    return { key: r.body.key as string, filename: name };
  };

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    X = await h.user('X');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    A = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Nhóm A' })).body.id;
    for (const u of [M1, M2, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [M1, M2]) await AD.call('POST', `/v1/groups/${A}/members`, { userId: u.id });
    convA = (await M1.call('GET', `/v1/groups/${A}/conversation`)).body.id;
  });
  afterAll(async () => h?.close());

  it('gửi tin kèm tệp → người trong nhóm thấy và lấy URL ngắn hạn; ngoài nhóm → not_found (F14-T4)', async () => {
    const f = await upload(M1);
    expect(f.key.startsWith(`${orgId}/${M1.id}/`)).toBe(true);
    expect(f.key.endsWith('/bai_hat.pdf')).toBe(true);
    const m = (await M1.call('POST', `/v1/conversations/${convA}/messages`, { clientMsgId: `c-${++n}-xxxxxxxx`, body: 'Bài hát', mentionIds: [], attachments: [f] })).body;
    expect(m.attachments).toEqual([expect.objectContaining({ filename: 'bài hát.pdf', mime: 'application/pdf', sizeBytes: 1000 })]);
    const id = m.attachments[0].id;
    const url = await M2.call('GET', `/v1/attachments/${id}/url`);
    expect(url.body.url).toContain(f.key);
    expect(new Date(url.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect((await X.call('GET', `/v1/attachments/${id}/url`)).status).toBe(404);
    // Dùng lại khoá đã gắn → từ chối; khoá của người khác → từ chối; chưa tải lên → từ chối.
    const again = await M1.call('POST', `/v1/conversations/${convA}/messages`, { clientMsgId: `c-${++n}-xxxxxxxx`, body: 'x', mentionIds: [], attachments: [f] });
    expect(again.body.error.fields).toEqual({ attachments: 'already_attached' });
    const other = await upload(M2);
    expect((await M1.call('POST', `/v1/conversations/${convA}/messages`, { clientMsgId: `c-${++n}-xxxxxxxx`, body: 'x', mentionIds: [], attachments: [other] })).body.error.fields).toEqual({ attachments: 'foreign_key' });
    const ghost = (await M1.call('POST', `/v1/organizations/${orgId}/uploads`, { filename: 'a.png', size: 5 })).body;
    expect((await M1.call('POST', `/v1/conversations/${convA}/messages`, { clientMsgId: `c-${++n}-xxxxxxxx`, body: 'x', mentionIds: [], attachments: [{ key: ghost.key, filename: 'a.png' }] })).body.error.fields).toEqual({ attachments: 'not_uploaded' });
    // Xoá tin → tệp không còn tải được.
    await M1.call('DELETE', `/v1/messages/${m.id}`);
    expect((await M2.call('GET', `/v1/attachments/${id}/url`)).status).toBe(404);
  });

  it('tệp quá 20 MB bị từ chối; người ngoài tổ chức không xin được URL tải lên', async () => {
    expect((await M1.call('POST', `/v1/organizations/${orgId}/uploads`, { filename: 'x', size: 21 * 1024 * 1024 })).body.error.fields).toEqual({ size: 'too_large' });
    const Z = await h.user('Z');
    expect((await Z.call('POST', `/v1/organizations/${orgId}/uploads`, { filename: 'x', size: 1 })).status).toBe(404);
  });

  it('tệp của Event: chỉ người sửa được Event thêm; người theo dõi nhận thông báo; người tải lên gỡ được', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Lễ', startsAt: '2036-01-05T01:00:00Z', endsAt: '2036-01-05T02:00:00Z' })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
    await M2.call('PUT', `/v1/subscriptions/event/${ev.id}`, { mode: 'follow' });
    expect((await M1.call('POST', `/v1/events/${ev.id}/attachments`, await upload(M1))).status).toBe(403);
    const a = await AD.call('POST', `/v1/events/${ev.id}/attachments`, await upload(AD, 'chương trình.pdf'));
    expect(a.status).toBe(201);
    expect((await M1.call('GET', `/v1/events/${ev.id}/attachments`)).body.map((x: { filename: string }) => x.filename)).toEqual(['chương trình.pdf']);
    await h.dispatch();
    const note = (await h.db.query(`select 1 from app.notification_items where verb = 'attachment.added' and notification_id in (select id from app.notifications where user_id = $1)`, [M2.id])).rowCount;
    expect(note).toBe(1);
    expect((await M1.call('DELETE', `/v1/attachments/${a.body.id}`)).status).toBe(403);
    expect((await AD.call('DELETE', `/v1/attachments/${a.body.id}`)).status).toBe(200);
    expect((await M1.call('GET', `/v1/events/${ev.id}/attachments`)).body).toEqual([]);
  });

  it('tệp của Task: người cùng làm thêm được; người ngoài Task riêng → not_found', async () => {
    const t = (await M1.call('POST', '/v1/tasks', { orgId, title: 'Riêng', scope: { type: 'private' } })).body;
    await M1.call('POST', `/v1/tasks/${t.id}/collaborators`, { add: [M2.id] });
    const a = await M2.call('POST', `/v1/tasks/${t.id}/attachments`, await upload(M2));
    expect(a.status).toBe(201);
    expect((await X.call('GET', `/v1/attachments/${a.body.id}/url`)).status).toBe(404);
    expect((await X.call('POST', `/v1/tasks/${t.id}/attachments`, await upload(X))).status).toBe(404);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S11 — Liên kết (F10, CONTEXT_ENGINE). */
describe.skipIf(!TEST_DB_URL)('F10: liên kết', () => {
  let h: Harness;
  let AD: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser;
  let orgId: string, A: string, B: string, convA: string, convB: string;
  let n = 0;
  const send = async (u: TestUser, conv: string, body: string, refs?: Array<{ type: string; id: string }>) =>
    u.call('POST', `/v1/conversations/${conv}/messages`, { clientMsgId: `c-${++n}-xxxxxxxx`, body, mentionIds: [], ...(refs ? { refs } : {}) });
  const at = (d: number) => new Date(Date.UTC(2035, 0, d, 1)).toISOString();

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    X = await h.user('X');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    A = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Nhóm A' })).body.id;
    B = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Nhóm B' })).body.id;
    for (const u of [M1, M2, M3, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [M1, M2]) await AD.call('POST', `/v1/groups/${A}/members`, { userId: u.id });
    for (const u of [M3]) await AD.call('POST', `/v1/groups/${B}/members`, { userId: u.id });
    convA = (await M1.call('GET', `/v1/groups/${A}/conversation`)).body.id;
    convB = (await M3.call('GET', `/v1/groups/${B}/conversation`)).body.id;
  });
  afterAll(async () => h?.close());

  it('F10-T1/T2: tạo Task từ tin nhóm → scope group; tin gốc mở được; thẻ Task dưới tin; X (ngoài nhóm) thấy Task, tin gốc không khả dụng', async () => {
    const msg = (await send(M1, convA, 'Ai chuẩn bị micro tuần này?')).body;
    const t = await M1.call('POST', '/v1/tasks', { title: 'Chuẩn bị micro', sourceMessageId: msg.id, ownerId: X.id });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.scope).toMatchObject({ type: 'group', id: A });
    expect(t.body.source).toMatchObject({ available: true, messageId: msg.id, conversationId: convA, excerpt: 'Ai chuẩn bị micro tuần này?' });
    const page = (await M2.call('GET', `/v1/conversations/${convA}/messages`)).body.messages;
    expect(page.find((m: { id: string }) => m.id === msg.id).cards).toEqual([
      { relation: 'created_from', type: 'task', id: t.body.id, available: true, title: 'Chuẩn bị micro', subtitle: 'Việc' },
    ]);
    const xt = (await X.call('GET', `/v1/tasks/${t.body.id}`)).body;
    expect(xt.source).toEqual({ available: false, messageId: null, conversationId: null, anchor: null, senderName: null, excerpt: null });
    expect((await X.call('GET', `/v1/conversations/${convA}/messages`)).status).toBe(404);
    expect((await X.call('POST', '/v1/tasks', { title: 'x', sourceMessageId: msg.id })).status).toBe(404);
  });

  it('F10-T3: thẻ Event visibility = groups mà M3 không xem được → "Nội dung bị giới hạn"; người gửi không xem được → not_found', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Tập hát', startsAt: at(3), endsAt: at(4), groupIds: [A], visibility: 'groups' })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
    await AD.call('POST', `/v1/groups/${B}/members`, { userId: M1.id });
    const m = (await send(M1, convB, 'Mọi người xem buổi này', [{ type: 'event', id: ev.id }])).body;
    expect(m.cards[0]).toMatchObject({ type: 'event', available: true, title: 'Tập hát' });
    const seen = (await M3.call('GET', `/v1/conversations/${convB}/messages`)).body.messages.find((x: { id: string }) => x.id === m.id);
    expect(seen.cards).toEqual([{ relation: 'references', type: 'event', id: ev.id, available: false, title: null, subtitle: null }]);
    expect((await send(M3, convB, 'x', [{ type: 'event', id: ev.id }])).status).toBe(404);
  });

  it('F10-T4/T6: Liên quan của Event — người nhóm A thấy tin từ A, không thấy tin từ B (đếm ẩn); thẻ chèn hai lần → một Link', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', startsAt: at(5), endsAt: at(6) })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
    const url = `https://x.test/app/#event=${ev.id}`;
    const a = (await send(M2, convA, `Xem ${url} và ${url}`, [{ type: 'event', id: ev.id }])).body;
    await send(M3, convB, `Bên B cũng nói ${url}`);
    expect((await h.db.query(`select count(*)::int c from app.links where from_id = $1`, [a.id])).rows[0].c).toBe(1);
    const rel = (await M2.call('GET', `/v1/events/${ev.id}/related`)).body;
    expect(rel.messages.map((x: { excerpt: string }) => x.excerpt)).toEqual([`Xem ${url} và ${url}`]);
    expect(rel.hiddenCount).toBe(1);
    expect((await M3.call('GET', `/v1/events/${ev.id}/related`)).body).toMatchObject({ hiddenCount: 1, messages: [expect.objectContaining({ anchor: { type: 'group', id: B, name: 'Nhóm B' } })] });
  });

  it('F10-T5: xoá tin gốc → references biến mất, created_from còn; Task hiện tin gốc không khả dụng', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Họp', startsAt: at(7), endsAt: at(8) })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
    const msg = (await send(M1, convA, `Chuẩn bị #event=${ev.id}`)).body;
    const t = (await M1.call('POST', '/v1/tasks', { title: 'Chuẩn bị', sourceMessageId: msg.id })).body;
    await M1.call('DELETE', `/v1/messages/${msg.id}`);
    const links = (await h.db.query(`select relation, deleted_at is not null as gone from app.links where from_id = $1 or to_id = $1 order by relation`, [msg.id])).rows;
    expect(links).toEqual([
      { relation: 'created_from', gone: false },
      { relation: 'references', gone: true },
    ]);
    const unl = (await h.db.query(`select a.cause_id = d.id ok from app.activity_events a, app.activity_events d where a.verb = 'context.unlinked' and d.verb = 'message.deleted' and d.object_id = $1 and a.cause_id = d.id`, [msg.id])).rows;
    expect(unl).toEqual([{ ok: true }]);
    expect((await M1.call('GET', `/v1/tasks/${t.id}`)).body.source.available).toBe(false);
    expect((await M1.call('GET', `/v1/events/${ev.id}/related`)).body.messages).toEqual([]);
  });

  it('F10-T7: sửa tin, bỏ thẻ → Link bị gỡ, context.unlinked được ghi', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Dọn dẹp', startsAt: at(9), endsAt: at(10) })).body.event;
    const msg = (await send(M1, convA, `Nhớ #event=${ev.id}`)).body;
    expect(msg.cards).toHaveLength(0); // bản nháp: M1 không xem được → đường dẫn bị bỏ qua
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
    const ed = await M1.call('PATCH', `/v1/messages/${msg.id}`, { body: `Nhớ #event=${ev.id}`, mentionIds: [] });
    expect(ed.body.cards).toHaveLength(1);
    const ed2 = await M1.call('PATCH', `/v1/messages/${msg.id}`, { body: 'Nhớ nhé', mentionIds: [] });
    expect(ed2.body.cards).toEqual([]);
    expect((await h.db.query(`select count(*)::int c from app.activity_events where verb = 'context.unlinked' and payload->>'link_id' in (select id::text from app.links where from_id = $1)`, [msg.id])).rows[0].c).toBe(1);
  });

  it('Link giữa hai đối tượng: cần sửa một đầu và xem đầu kia; hiện hai chiều; gỡ được', async () => {
    const e1 = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Tập', startsAt: at(11), endsAt: at(12) })).body.event;
    const e2 = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Lễ chính', startsAt: at(12), endsAt: at(13) })).body.event;
    for (const e of [e1, e2]) await AD.call('POST', `/v1/events/${e.id}/publish`, { expectedVersion: e.version });
    expect((await M1.call('POST', '/v1/links', { from: { type: 'event', id: e1.id }, to: { type: 'event', id: e2.id } })).status).toBe(403);
    const l = await AD.call('POST', '/v1/links', { from: { type: 'event', id: e1.id }, to: { type: 'event', id: e2.id } });
    expect(l.status).toBe(201);
    expect((await AD.call('POST', '/v1/links', { from: { type: 'event', id: e2.id }, to: { type: 'event', id: e1.id } })).body.linkId).toBe(l.body.linkId);
    expect((await M1.call('GET', `/v1/events/${e2.id}/related`)).body.objects).toEqual([expect.objectContaining({ type: 'event', id: e1.id, title: 'Tập', canUnlink: false })]);
    expect((await M1.call('DELETE', `/v1/links/${l.body.linkId}`)).status).toBe(403);
    expect((await AD.call('DELETE', `/v1/links/${l.body.linkId}`)).status).toBe(200);
    expect((await AD.call('GET', `/v1/events/${e1.id}/related`)).body.objects).toEqual([]);
  });
});

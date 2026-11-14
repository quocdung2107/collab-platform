import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S6 — lõi thông báo (F11a, NOTIFICATION_ENGINE). Ký hiệu như MVP_ACCEPTANCE_CRITERIA. */
describe.skipIf(!TEST_DB_URL)('F11: lõi thông báo', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, OW: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser;
  let orgId: string, sound: string;
  let day = 0;
  const slot = () => {
    day += 1;
    return { startsAt: new Date(Date.UTC(2031, 0, day, 1)).toISOString(), endsAt: new Date(Date.UTC(2031, 0, day, 3)).toISOString() };
  };
  const cid = () => `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const newEvent = async (body: Record<string, unknown> = {}) =>
    (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', ...slot(), groupIds: [sound], ...body })).body.event;
  const addPosition = async (eventId: string, body: Record<string, unknown> = {}) =>
    (await AD.call('POST', `/v1/events/${eventId}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1, ...body })).body.positions.at(-1);
  const assign = (u: TestUser, positionId: string, who: TestUser) => u.call('POST', `/v1/positions/${positionId}/assignments`, { userId: who.id });
  const publish = async (u: TestUser, eventId: string) => {
    const v = (await u.call('GET', `/v1/events/${eventId}`)).body.version;
    return u.call('POST', `/v1/events/${eventId}/publish`, { expectedVersion: v });
  };
  const rows = async (u: TestUser, objectId?: string) =>
    (
      await h.db.query(
        `select n.id, n.class, n.action_state, n.reasons, n.read_at, n.object_type, n.object_id,
                (select count(*)::int from app.notification_items i where i.notification_id = n.id) as items
           from app.notifications n where n.user_id = $1 and ($2::uuid is null or n.object_id = $2) order by n.created_at`,
        [u.id, objectId ?? null],
      )
    ).rows;
  const inbox = async (u: TestUser) => (await u.call('GET', '/v1/notifications')).body;

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    OW = await h.user('OW');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    X = await h.user('X');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, OW, M1, M2, M3, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [LD, M1, M2, M3]) await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });
    await h.dispatch();
    await h.db.query('delete from app.notifications');
  });
  afterAll(async () => h?.close());

  it('F3-T1: bản nháp có người được xếp → không có thông báo', async () => {
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    await h.dispatch();
    expect(await rows(M1, ev.id)).toHaveLength(0);
  });

  it('F3-T2/T3: publish → mỗi người được xếp đúng một "Cần bạn"; người ở 2 vị trí → một bản ghi liệt kê 2 vị trí', async () => {
    const ev = await newEvent();
    const a = await addPosition(ev.id, { name: 'Âm thanh', slots: 2 });
    const b = await addPosition(ev.id, { name: 'Máy chiếu', groupId: null });
    await assign(AD, a.id, M1);
    await assign(AD, a.id, M2);
    await assign(AD, b.id, M1);
    await publish(AD, ev.id);
    await h.dispatch();
    const m1 = await rows(M1, ev.id);
    expect(m1).toEqual([expect.objectContaining({ class: 'action_required', action_state: 'pending', items: 2 })]);
    expect(await rows(M2, ev.id)).toEqual([expect.objectContaining({ class: 'action_required', items: 1 })]);
    const item = (await inbox(M1)).items.find((n: { target: { id: string } }) => n.target.id === ev.id);
    expect(item.lines).toEqual([expect.stringMatching(/^Bạn được xếp vào Âm thanh/), expect.stringMatching(/^Bạn được xếp vào Máy chiếu/)]);
    expect(item.pendingAssignments).toHaveLength(2);
    // N1: AD (actor, owner) không nhận gì về hành động của mình.
    expect(await rows(AD, ev.id)).toHaveLength(0);
  });

  it('F3-T4 / N10: thành viên chung của nhóm không có bản ghi; chỉ thấy dòng hệ thống trong hội thoại nhóm', async () => {
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    await publish(AD, ev.id);
    await h.dispatch();
    expect(await rows(M3, ev.id)).toHaveLength(0);
    const conv = (await M3.call('GET', `/v1/groups/${sound}/conversation`)).body;
    const msgs = (await M3.call('GET', `/v1/conversations/${conv.id}/messages`)).body.messages;
    const sys = msgs.filter((m: { kind: string }) => m.kind === 'system');
    expect(sys.at(-1).body).toMatch(/AD đã công bố buổi "Chúa nhật"/);
    // Dòng hệ thống không tính chưa đọc.
    expect(conv.unreadCount).toBe(0);
    // Thread của Event: một dòng cho publish, không lặp từng assignment.requested con.
    const evConv = (await M1.call('GET', `/v1/events/${ev.id}`)).body.conversationId;
    const evMsgs = (await M1.call('GET', `/v1/conversations/${evConv}/messages`)).body.messages;
    expect(evMsgs.map((m: { body: string }) => m.body)).toEqual([expect.stringMatching(/công bố/)]);
  });

  it('F11-T3 (N8): xử lý lại cùng ActivityEvent 3 lần → không thêm bản ghi, mục hay dòng hệ thống', async () => {
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    await publish(AD, ev.id);
    await h.dispatch();
    const count = async () =>
      (
        await h.db.query(
          `select (select count(*) from app.notifications)::int n, (select count(*) from app.notification_items)::int i, (select count(*) from app.messages where kind = 'system')::int m`,
        )
      ).rows[0];
    const before = await count();
    for (let k = 0; k < 3; k++) {
      await h.db.query(`update app.activity_events set dispatched_at = null where event_id = $1`, [ev.id]);
      await h.dispatch();
    }
    expect(await count()).toEqual(before);
  });

  it('F11-T15: outbox dồn lại (notifier ngừng) → xử lý đúng thứ tự, không mất, không trùng; mục của Assignment đã huỷ → superseded', async () => {
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    await publish(AD, ev.id);
    // Bỏ vị trí trước khi notifier chạy: yêu cầu cũ phải kết thúc ở superseded, không treo pending (N7).
    await AD.call('DELETE', `/v1/positions/${pos.id}`);
    await h.dispatch();
    const m1 = await rows(M1, ev.id);
    expect(m1.map((n) => [n.class, n.action_state])).toEqual([
      ['action_required', 'superseded'],
      ['direct', 'none'],
    ]);
  });

  it('assignment.cancelled (position_removed) với người đã có bản ghi → "Nên biết" riêng, bản ghi chờ → superseded', async () => {
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M2);
    await publish(AD, ev.id);
    await h.dispatch();
    await AD.call('DELETE', `/v1/positions/${pos.id}`);
    await h.dispatch();
    const m2 = await rows(M2, ev.id);
    expect(m2.map((n) => [n.class, n.action_state])).toEqual([
      ['action_required', 'superseded'],
      ['direct', 'none'],
    ]);
  });

  it('xếp thêm sau khi publish trong 10 phút → gộp vào bản ghi "Cần bạn" chưa đọc (family assignment.request)', async () => {
    const ev = await newEvent();
    const a = await addPosition(ev.id);
    const b = await addPosition(ev.id, { name: 'Ánh sáng', groupId: null });
    await assign(AD, a.id, M3);
    await publish(AD, ev.id);
    await h.dispatch();
    await assign(AD, b.id, M3);
    await h.dispatch();
    expect(await rows(M3, ev.id)).toEqual([expect.objectContaining({ action_state: 'pending', items: 2 })]);
  });

  it('F9-T6 / F9-T5: mention → "Nên biết"; sửa thêm mention M2 → chỉ M2 nhận mới; xoá tin → thu hồi', async () => {
    const conv = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body.id;
    const sent = (await M1.call('POST', `/v1/conversations/${conv}/messages`, { clientMsgId: cid(), body: '@M3 xem giúp', mentionIds: [M3.id] })).body;
    await h.dispatch();
    expect(await rows(M3, sent.id)).toEqual([expect.objectContaining({ class: 'direct', reasons: ['mentioned'] })]);
    expect((await inbox(M3)).items[0]).toMatchObject({ lines: ['M1 đã nhắc tới bạn'], link: { route: 'group', id: sound } });
    await M1.call('PATCH', `/v1/messages/${sent.id}`, { body: '@M3 @M2 xem giúp', mentionIds: [M3.id, M2.id] });
    await h.dispatch();
    expect(await rows(M3, sent.id)).toHaveLength(1);
    expect(await rows(M2, sent.id)).toHaveLength(1);
    await M1.call('DELETE', `/v1/messages/${sent.id}`);
    await h.dispatch();
    expect(await rows(M3, sent.id)).toHaveLength(0);
    expect(await rows(M2, sent.id)).toHaveLength(0);
  });

  it('trả lời tin → người có tin được trả lời nhận "Nên biết"; nội dung tin không có trong thông báo', async () => {
    const conv = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body.id;
    const orig = (await M2.call('POST', `/v1/conversations/${conv}/messages`, { clientMsgId: cid(), body: 'bí mật 123', mentionIds: [] })).body;
    const reply = (await M1.call('POST', `/v1/conversations/${conv}/messages`, { clientMsgId: cid(), body: 'ok', replyToId: orig.id, mentionIds: [] })).body;
    await h.dispatch();
    const n = (await inbox(M2)).items.find((x: { target: { id: string } }) => x.target.id === reply.id);
    expect(n.lines).toEqual(['M1 đã trả lời tin của bạn']);
    expect(JSON.stringify(n)).not.toContain('bí mật');
  });

  it('event.updated: người phụ trách và người theo dõi nhận "Nên biết"; người được xếp thì không (notify_assignees = false)', async () => {
    const ev = await newEvent();
    await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id] });
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    const pub = (await publish(AD, ev.id)).body.event;
    expect((await X.call('PUT', `/v1/subscriptions/event/${ev.id}`, { mode: 'follow' })).status).toBe(200);
    await h.dispatch();
    await AD.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: pub.version, title: 'Chúa nhật (đổi tên)' });
    await h.dispatch();
    const ow = await rows(OW, ev.id);
    expect(ow.at(-1)).toMatchObject({ class: 'direct', reasons: ['event_owner'] });
    expect((await rows(X, ev.id)).at(-1)).toMatchObject({ reasons: ['subscriber'] });
    // M1: không thêm bản ghi mới; bản ghi "Cần bạn" giữ nguyên một mục.
    expect(await rows(M1, ev.id)).toEqual([expect.objectContaining({ items: 1 })]);
    // F11-T5: chuyển sang mute → lần sửa sau không nhận gì.
    await X.call('PUT', `/v1/subscriptions/event/${ev.id}`, { mode: 'mute' });
    const v = (await AD.call('GET', `/v1/events/${ev.id}`)).body.version;
    await AD.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: v, description: 'mô tả' });
    await h.dispatch();
    expect((await rows(X, ev.id)).length).toBe(1);
    expect((await X.call('GET', `/v1/subscriptions/event/${ev.id}`)).body).toEqual({ mode: 'mute' });
  });

  it('F11-T11 (N3): người không xem được đối tượng không có bản ghi; mất quyền sau đó → "Nội dung không còn khả dụng"', async () => {
    const ev = await newEvent({ visibility: 'groups' });
    expect((await X.call('PUT', `/v1/subscriptions/event/${ev.id}`, { mode: 'follow' })).status).toBe(404); // bản nháp
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, M1);
    await publish(AD, ev.id);
    await h.dispatch();
    // M1 rời nhóm và bị bỏ vị trí → mất quyền xem.
    await AD.call('DELETE', `/v1/positions/${pos.id}`);
    await M1.call('POST', `/v1/groups/${sound}/leave`);
    await h.dispatch();
    const items = (await inbox(M1)).items.filter((n: { target: { id: string } }) => n.target.id === ev.id);
    expect(items.length).toBeGreaterThan(0);
    for (const n of items) expect(n).toMatchObject({ available: false, title: null, lines: ['Nội dung không còn khả dụng'] });
    await AD.call('POST', `/v1/groups/${sound}/members`, { userId: M1.id });
  });

  it('F11-T13: "đánh dấu tất cả đã đọc" không đụng "Cần bạn"; đọc từng bản ghi; bản ghi người khác → not_found', async () => {
    await h.dispatch();
    const before = await inbox(M2);
    expect(before.pendingCount).toBeGreaterThan(0);
    const after = (await M2.call('POST', '/v1/notifications/read-all')).body;
    expect(after.pendingCount).toBe(before.pendingCount);
    const stillUnread = await h.db.query(`select count(*)::int n from app.notifications where user_id = $1 and read_at is null`, [M2.id]);
    expect(stillUnread.rows[0].n).toBe(after.unreadCount);
    expect(after.unreadCount).toBeGreaterThan(0); // các bản ghi action_required chưa đọc
    const pending = (await M2.call('GET', '/v1/notifications?pending=true')).body.items[0];
    expect((await M2.call('POST', `/v1/notifications/${pending.id}/read`)).status).toBe(200);
    expect((await M3.call('POST', `/v1/notifications/${pending.id}/read`)).status).toBe(404);
    const again = (await M2.call('GET', '/v1/notifications?pending=true')).body.items.find((n: { id: string }) => n.id === pending.id);
    expect(again).toMatchObject({ actionState: 'pending' });
    expect(again.readAt).not.toBeNull();
  });

  it('group.member_added: người được thêm nhận "Nên biết"; thêm chính mình (actor) thì không', async () => {
    const g = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Đón tiếp' })).body.id;
    await AD.call('POST', `/v1/groups/${g}/members`, { userId: X.id });
    await AD.call('POST', `/v1/groups/${g}/members`, { userId: AD.id });
    await h.dispatch();
    expect(await rows(X, g)).toEqual([expect.objectContaining({ class: 'direct', reasons: ['target_user'] })]);
    expect(await rows(AD, g)).toHaveLength(0);
    expect((await inbox(X)).items[0].lines).toEqual(['AD đã thêm bạn vào nhóm']);
  });

  it('tín hiệu realtime notification.created tới kênh user:{id} của người nhận', async () => {
    h.realtime.sent.length = 0;
    const ev = await newEvent();
    const pos = await addPosition(ev.id);
    await assign(AD, pos.id, X);
    await publish(AD, ev.id);
    await h.dispatch();
    expect(h.realtime.sent.some((s) => s.topic === `user:${X.id}` && s.event === 'notification.created')).toBe(true);
  });
});

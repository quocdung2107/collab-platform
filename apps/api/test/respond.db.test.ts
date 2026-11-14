import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S7 — trả lời phân công, gỡ và thay người (F5, F6, F1-T4). */
describe.skipIf(!TEST_DB_URL)('F5/F6: trả lời, gỡ, thay người', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, OW: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser;
  let orgId: string, sound: string;
  let day = 0;
  const slot = () => {
    day += 1;
    return { startsAt: new Date(Date.UTC(2032, 0, day, 1)).toISOString(), endsAt: new Date(Date.UTC(2032, 0, day, 3)).toISOString() };
  };

  /** Buổi đã công bố, OW phụ trách, một vị trí của nhóm Âm thanh, đã xếp `people`. */
  const setup = async (people: TestUser[], opts: { slots?: number; visibility?: 'org' | 'groups' } = {}) => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', ...slot(), groupIds: [sound], visibility: opts.visibility ?? 'org' })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id], remove: [AD.id] });
    const pos = (await OW.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: opts.slots ?? (people.length || 1) })).body.positions[0];
    for (const p of people) await OW.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: p.id });
    const v = (await OW.call('GET', `/v1/events/${ev.id}`)).body.version;
    await OW.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: v });
    await h.dispatch();
    const detail = (await OW.call('GET', `/v1/events/${ev.id}`)).body;
    const asg = (u: TestUser) => detail.positions[0].assignments.find((a: { userId: string }) => a.userId === u.id);
    return { ev, pos, asg };
  };
  const respond = (u: TestUser, id: string, body: Record<string, unknown>) => u.call('POST', `/v1/assignments/${id}/respond`, body);
  const notes = async (u: TestUser, eventId: string) =>
    (
      await h.db.query(
        `select class, action_state, reasons, (select array_agg(verb order by verb) from app.notification_items i where i.notification_id = n.id) as verbs
           from app.notifications n where user_id = $1 and object_id = $2 order by created_at`,
        [u.id, eventId],
      )
    ).rows;
  const events = async (verb: string, objectId: string) => (await h.db.query(`select payload, actor_id from app.activity_events where verb = $1 and object_id = $2`, [verb, objectId])).rows;

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
  });
  afterAll(async () => h?.close());

  it('F5-T1/T2: nhận → accepted, "Cần bạn" → done; bấm hai lần → một assignment.accepted', async () => {
    const { asg } = await setup([M1]);
    const a = asg(M1);
    const [r1, r2] = await Promise.all([respond(M1, a.id, { response: 'accept' }), respond(M1, a.id, { response: 'accept' })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.status).toBe('accepted');
    expect(await events('assignment.accepted', a.id)).toHaveLength(1);
    await h.dispatch();
    const n = await notes(M1, r1.body.event.id);
    expect(n).toEqual([expect.objectContaining({ class: 'action_required', action_state: 'done' })]);
  });

  it('F5-T3: M1 bấm Nhận sau khi OW đã gỡ → state_conflict "Bạn đã được gỡ khỏi vị trí này"', async () => {
    const { asg } = await setup([M1]);
    const a = asg(M1);
    expect((await OW.call('POST', `/v1/assignments/${a.id}/cancel`, {})).status).toBe(200);
    const r = await respond(M1, a.id, { response: 'accept' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'state_conflict', message: 'Bạn đã được gỡ khỏi vị trí này', current: { status: 'cancelled' } });
  });

  it('F5-T4: M1 từ chối → OW và LD mỗi người một "Cần bạn"; OW xếp M2 đủ slots → cả hai done', async () => {
    const { ev, pos, asg } = await setup([M1]);
    expect((await respond(M1, asg(M1).id, { response: 'decline' })).body.error.fields.reason).toBe('required');
    expect((await respond(M1, asg(M1).id, { response: 'decline', reason: 'Bận việc nhà' })).status).toBe(200);
    await h.dispatch();
    for (const u of [OW, LD]) {
      expect((await notes(u, ev.id)).filter((n) => n.class === 'action_required')).toEqual([
        expect.objectContaining({ action_state: 'pending', verbs: ['assignment.declined'] }),
      ]);
    }
    await OW.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: M2.id });
    await h.dispatch();
    for (const u of [OW, LD]) {
      expect((await notes(u, ev.id)).find((n) => n.verbs.includes('assignment.declined'))).toMatchObject({ action_state: 'done' });
    }
  });

  it('F5-T5: lý do từ chối — OW, LD, M1 thấy; M2 không', async () => {
    const { ev, asg } = await setup([M1, M2]);
    await respond(M1, asg(M1).id, { response: 'decline', reason: 'Đi công tác' });
    const reasonOf = async (u: TestUser) =>
      (await u.call('GET', `/v1/events/${ev.id}`)).body.positions[0].assignments.find((a: { userId: string }) => a.userId === M1.id).declineReason;
    expect(await reasonOf(OW)).toBe('Đi công tác');
    expect(await reasonOf(LD)).toBe('Đi công tác');
    expect(await reasonOf(M1)).toBe('Đi công tác');
    expect(await reasonOf(M2)).toBeNull();
  });

  it('F5-T6: OW trả lời hộ M1 → responded_by = OW; M1 nhận "Nên biết"', async () => {
    const { ev, asg } = await setup([M1]);
    const r = await respond(OW, asg(M1).id, { response: 'accept' });
    expect(r.body.status).toBe('accepted');
    const row = (await h.db.query(`select responded_by from app.assignments where id = $1`, [asg(M1).id])).rows[0];
    expect(row.responded_by).toBe(OW.id);
    await h.dispatch();
    const n = await notes(M1, ev.id);
    expect(n.find((x) => x.class === 'direct')).toMatchObject({ reasons: ['target_user'], verbs: ['assignment.accepted'] });
    expect(n.find((x) => x.class === 'action_required')).toMatchObject({ action_state: 'done' });
    const inbox = (await M1.call('GET', '/v1/notifications')).body.items.find((x: { class: string; target: { id: string } }) => x.class === 'direct' && x.target.id === ev.id);
    expect(inbox.lines).toEqual(['OW đã nhận thay bạn Âm thanh']);
    // M2 (thành viên khác) không trả lời hộ được.
    const other = await setup([M3]);
    expect((await respond(M2, other.asg(M3).id, { response: 'accept' })).status).toBe(403);
  });

  it('F5-T7: đã từ chối rồi bấm Nhận → state_conflict; expected_status lệch → state_conflict', async () => {
    const { asg } = await setup([M1]);
    await respond(M1, asg(M1).id, { response: 'decline', reason: 'Bận' });
    expect((await respond(M1, asg(M1).id, { response: 'accept' })).body.error.code).toBe('state_conflict');
    const b = await setup([M2]);
    expect((await respond(M2, b.asg(M2).id, { response: 'accept', expectedStatus: 'reconfirm' })).body.error).toMatchObject({
      code: 'state_conflict',
      current: { status: 'requested' },
    });
    // Đã nhận vẫn từ chối được (§F5 đầu vào).
    await respond(M2, b.asg(M2).id, { response: 'accept' });
    expect((await respond(M2, b.asg(M2).id, { response: 'decline', reason: 'Ốm' })).body.status).toBe('declined');
  });

  it('F6-T1: M1 requested, chưa đọc; OW thay bằng M2 → "Cần bạn" của M1 superseded + một "Nên biết"; M2 một "Cần bạn"', async () => {
    const { ev, asg } = await setup([M1]);
    const r = await OW.call('POST', `/v1/assignments/${asg(M1).id}/replace`, { newUserId: M2.id });
    expect(r.status).toBe(201);
    expect(r.body.assignment).toMatchObject({ userId: M2.id, status: 'requested' });
    const root = (await events('assignment.cancelled', asg(M1).id))[0];
    expect(root.payload).toMatchObject({ cancel_reason: 'replaced', replaced_by_assignment_id: r.body.assignment.id });
    await h.dispatch();
    expect((await notes(M1, ev.id)).map((n) => [n.class, n.action_state])).toEqual([
      ['action_required', 'superseded'],
      ['direct', 'none'],
    ]);
    expect((await notes(M2, ev.id)).map((n) => [n.class, n.action_state])).toEqual([['action_required', 'pending']]);
  });

  it('F6-T3: thay bằng người đã ở vị trí đó → duplicate_assignment, Assignment cũ giữ nguyên, không sự kiện', async () => {
    const { asg } = await setup([M1, M2]);
    const before = (await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n;
    const r = await OW.call('POST', `/v1/assignments/${asg(M1).id}/replace`, { newUserId: M2.id });
    expect(r.body.error.code).toBe('duplicate_assignment');
    expect((await h.db.query(`select status from app.assignments where id = $1`, [asg(M1).id])).rows[0].status).toBe('requested');
    expect((await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n).toBe(before);
    // Người ngoài tổ chức → not_a_member, cũng không đổi gì.
    const Z = await h.user('Z');
    expect((await OW.call('POST', `/v1/assignments/${asg(M1).id}/replace`, { newUserId: Z.id })).body.error.code).toBe('not_a_member');
    expect((await h.db.query(`select status from app.assignments where id = $1`, [asg(M1).id])).rows[0].status).toBe('requested');
  });

  it('F6-T4: Event visibility = groups, gỡ X → X mất quyền xem; Subscription bị xoá; access_changed; thông báo cũ "không còn khả dụng"', async () => {
    const { ev, asg } = await setup([X], { visibility: 'groups' });
    await X.call('PUT', `/v1/subscriptions/event/${ev.id}`, { mode: 'follow' });
    h.realtime.sent.length = 0;
    await OW.call('POST', `/v1/assignments/${asg(X).id}/cancel`, {});
    expect((await X.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
    expect((await h.db.query(`select 1 from app.subscriptions where user_id = $1 and target_id = $2`, [X.id, ev.id])).rowCount).toBe(0);
    expect(h.realtime.sent.some((s) => s.topic === `user:${X.id}` && s.event === 'access_changed')).toBe(true);
    await h.dispatch();
    const items = (await X.call('GET', '/v1/notifications')).body.items.filter((n: { target: { id: string } }) => n.target.id === ev.id);
    expect(items.length).toBeGreaterThan(0);
    for (const n of items) expect(n.available).toBe(false);
  });

  it('LD gỡ người ở vị trí nhóm mình được; M2 (không quản lý) → forbidden', async () => {
    const { asg } = await setup([M1, M3]);
    expect((await M2.call('POST', `/v1/assignments/${asg(M1).id}/cancel`, {})).status).toBe(403);
    expect((await LD.call('POST', `/v1/assignments/${asg(M1).id}/cancel`, {})).status).toBe(200);
    expect((await LD.call('POST', `/v1/assignments/${asg(M1).id}/cancel`, {})).body.error.code).toBe('state_conflict');
  });

  it('F1-T4: gỡ M3 có 2 Assignment accepted ở hai buổi tương lai của OW → cả hai member_left; OW một "Cần bạn" hai mục, done khi lấp đủ cả hai', async () => {
    const M4 = await h.user('M4');
    const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
    await M4.call('POST', `/v1/invites/${t}/accept`);
    const M3 = M4; // người chỉ có đúng hai Assignment này
    const a = await setup([M3]);
    const b = await setup([M3]);
    await respond(M3, a.asg(M3).id, { response: 'accept' });
    await respond(M3, b.asg(M3).id, { response: 'accept' });
    await h.dispatch();
    await h.db.query(`delete from app.notifications where user_id = $1`, [OW.id]);
    expect((await AD.call('DELETE', `/v1/organizations/${orgId}/members/${M3.id}`)).status).toBe(200);
    const st = await h.db.query(`select status, cancel_reason from app.assignments where id = any($1::uuid[])`, [[a.asg(M3).id, b.asg(M3).id]]);
    expect(st.rows).toEqual([
      { status: 'cancelled', cancel_reason: 'member_left' },
      { status: 'cancelled', cancel_reason: 'member_left' },
    ]);
    await h.dispatch();
    const ow = (await h.db.query(`select id, action_state, (select count(*)::int from app.notification_items i where i.notification_id = n.id) items from app.notifications n where user_id = $1`, [OW.id])).rows;
    expect(ow).toEqual([expect.objectContaining({ action_state: "pending", items: 2 })]);
    await OW.call('POST', `/v1/positions/${a.pos.id}/assignments`, { userId: M1.id });
    await h.dispatch();
    expect((await h.db.query(`select action_state from app.notifications where id = $1`, [ow[0].id])).rows[0].action_state).toBe('pending');
    await OW.call('POST', `/v1/positions/${b.pos.id}/assignments`, { userId: M1.id });
    await h.dispatch();
    expect((await h.db.query(`select action_state from app.notifications where id = $1`, [ow[0].id])).rows[0].action_state).toBe('done');
    expect((await M3.call('GET', `/v1/events/${a.ev.id}`)).status).toBe(404);
  });

  it('gỡ người phụ trách duy nhất khỏi tổ chức → người thực hiện lệnh nhận thay; Event không mất người phụ trách', async () => {
    const Y = await h.user('Y');
    const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
    await Y.call('POST', `/v1/invites/${t}/accept`);
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Họp', ...slot() })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [Y.id], remove: [AD.id] });
    await AD.call('DELETE', `/v1/organizations/${orgId}/members/${Y.id}`);
    const owners = (await AD.call('GET', `/v1/events/${ev.id}`)).body.owners.map((o: { userId: string }) => o.userId);
    expect(owners).toEqual([AD.id]);
  });
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S9 — dời lịch, đổi địa điểm, huỷ (F7, NOTIFICATION_ENGINE §8.5). */
describe.skipIf(!TEST_DB_URL)('F7: dời lịch, đổi địa điểm, huỷ', () => {
  let h: Harness;
  let AD: TestUser, OW: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser;
  let orgId: string, sound: string;
  let day = 0;
  const at = (d: number, hour: number, min = 0) => new Date(Date.UTC(2033, 0, d, hour, min)).toISOString();

  /** Buổi đã công bố do OW phụ trách; M1 đã nhận, M2 còn chờ; X (ngoài nhóm) đã nhận nếu withX. */
  const setup = async (opts: { visibility?: 'org' | 'groups'; withX?: boolean } = {}) => {
    day += 2;
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', startsAt: at(day, 1), endsAt: at(day, 3), groupIds: [sound], visibility: opts.visibility ?? 'org' })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id], remove: [AD.id] });
    const pos = (await OW.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 3 })).body.positions[0];
    const people = opts.withX ? [M1, M2, X] : [M1, M2];
    for (const p of people) await OW.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: p.id });
    let v = (await OW.call('GET', `/v1/events/${ev.id}`)).body.version;
    await OW.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: v });
    const asg = async (u: TestUser) => (await h.db.query(`select id, status from app.assignments where event_id = $1 and user_id = $2`, [ev.id, u.id])).rows[0];
    await M1.call('POST', `/v1/assignments/${(await asg(M1)).id}/respond`, { response: 'accept' });
    if (opts.withX) await X.call('POST', `/v1/assignments/${(await asg(X)).id}/respond`, { response: 'accept' });
    await h.dispatch();
    v = (await OW.call('GET', `/v1/events/${ev.id}`)).body.version;
    return { id: ev.id as string, pos, asg, version: v as number };
  };
  const notes = async (u: TestUser, eventId: string) =>
    (
      await h.db.query(
        `select n.class, n.action_state, n.read_at, (select array_agg(i.verb order by a.seq) from app.notification_items i join app.activity_events a on a.id = i.activity_event_id where i.notification_id = n.id) as verbs
           from app.notifications n where n.user_id = $1 and n.object_id = $2 order by n.created_at`,
        [u.id, eventId],
      )
    ).rows;
  const version = async (id: string) => (await OW.call('GET', `/v1/events/${id}`)).body.version;

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    OW = await h.user('OW');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    X = await h.user('X');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [OW, M1, M2, M3, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [M1, M2, M3]) await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    await h.dispatch();
  });
  afterAll(async () => h?.close());

  it('F7-T1: dời 2 giờ → M1 accepted → reconfirm, một "Cần bạn"; M2 requested giữ nguyên, bản ghi chờ được làm mới, không có bản ghi thứ hai', async () => {
    const e = await setup();
    const r = await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 3), endsAt: at(day, 5) });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ reconfirmCount: 1, notifiedCount: 2 });
    expect((await e.asg(M1)).status).toBe('reconfirm');
    expect((await e.asg(M2)).status).toBe('requested');
    const root = (await h.db.query(`select id from app.activity_events where verb = 'event.rescheduled' and object_id = $1`, [e.id])).rows[0];
    const kids = await h.db.query(`select verb from app.activity_events where cause_id = $1`, [root.id]);
    expect(kids.rows.map((k) => k.verb)).toEqual(['assignment.reconfirm_requested']);
    await h.dispatch();
    const m1 = await notes(M1, e.id);
    expect(m1.filter((n) => n.action_state === 'pending')).toEqual([expect.objectContaining({ class: 'action_required', verbs: ['event.rescheduled', 'assignment.reconfirm_requested'] })]);
    const m2 = await notes(M2, e.id);
    expect(m2).toEqual([expect.objectContaining({ action_state: 'pending', verbs: ['assignment.requested', 'event.rescheduled'] })]);
    const line = (await M1.call('GET', '/v1/notifications')).body.items.find((n: { actionState: string; target: { id: string } }) => n.actionState === 'pending' && n.target.id === e.id);
    expect(line.lines).toContain('Buổi đổi giờ: xác nhận lại Âm thanh');
    expect(line.lines.some((l: string) => l.startsWith('Dời giờ:'))).toBe(true);
    expect(line.pendingAssignments).toEqual([{ id: (await e.asg(M1)).id, status: 'reconfirm' }]);
  });

  it('F7-T2: dời 10 phút (< ngưỡng, cùng ngày) → M1 vẫn accepted, nhận "Nên biết"', async () => {
    const e = await setup();
    await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 1, 10), endsAt: at(day, 3, 10) });
    expect((await e.asg(M1)).status).toBe('accepted');
    await h.dispatch();
    expect((await notes(M1, e.id)).at(-1)).toMatchObject({ class: 'direct', verbs: ['event.rescheduled'] });
  });

  it('dời sang ngày khác dù < ngưỡng (theo múi giờ tổ chức) → xác nhận lại', async () => {
    const e = await setup();
    // 16:50 UTC = 23:50 giờ VN; dời 20 phút sang 00:10 ngày hôm sau (giờ VN).
    const v1 = (await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 16, 50), endsAt: at(day, 17, 50) })).body.event.version;
    await M1.call('POST', `/v1/assignments/${(await e.asg(M1)).id}/respond`, { response: 'accept' });
    const v2 = await version(e.id);
    expect(v2).toBeGreaterThanOrEqual(v1);
    await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: v2, startsAt: at(day, 17, 10), endsAt: at(day, 18, 10) });
    expect((await e.asg(M1)).status).toBe('reconfirm');
  });

  it('F7-T6: dời 3 lần trong 5 phút → mỗi người một bản ghi, hiển thị giờ cuối; F7-T7: xác nhận lại → accepted, done', async () => {
    const e = await setup();
    let v = e.version;
    for (const hour of [4, 6, 8]) {
      v = (await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: v, startsAt: at(day, hour), endsAt: at(day, hour + 2) })).body.event.version;
      await h.dispatch();
    }
    const m1 = await notes(M1, e.id);
    expect(m1.filter((n) => n.class === 'action_required' && n.action_state === 'pending')).toHaveLength(1);
    expect(m1.filter((n) => (n.verbs as string[]).includes('event.rescheduled'))).toHaveLength(1);
    const item = (await M1.call('GET', '/v1/notifications')).body.items.find((n: { actionState: string; target: { id: string } }) => n.actionState === 'pending' && n.target.id === e.id);
    expect(item.subtitle).toContain('15:00'); // 08:00 UTC = 15:00 giờ VN
    await M1.call('POST', `/v1/assignments/${(await e.asg(M1)).id}/respond`, { response: 'accept' });
    await h.dispatch();
    expect((await notes(M1, e.id)).filter((n) => n.class === 'action_required').map((n) => n.action_state)).toEqual(['done', 'done']);
  });

  it('F7-T7: từ chối khi xác nhận lại → position_managers nhận "Cần bạn"', async () => {
    const e = await setup();
    await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 6), endsAt: at(day, 8) });
    await M1.call('POST', `/v1/assignments/${(await e.asg(M1)).id}/respond`, { response: 'decline', reason: 'Trùng lịch' });
    await h.dispatch();
    expect((await notes(OW, e.id)).filter((n) => n.class === 'action_required')).toEqual([expect.objectContaining({ action_state: 'pending', verbs: ['assignment.declined'] })]);
  });

  it('đổi địa điểm: người được xếp nhận "Nên biết", không xác nhận lại', async () => {
    const e = await setup();
    expect((await OW.call('POST', `/v1/events/${e.id}/relocate`, { expectedVersion: e.version, location: 'Hội trường B' })).status).toBe(200);
    expect((await e.asg(M1)).status).toBe('accepted');
    await h.dispatch();
    expect((await notes(M1, e.id)).at(-1)).toMatchObject({ class: 'direct', verbs: ['event.relocated'] });
    // M2 đang chờ trả lời: bản ghi chờ được làm mới thay vì bản ghi mới.
    expect(await notes(M2, e.id)).toHaveLength(1);
  });

  it('F7-T8 / F9-T8: huỷ → bản ghi chờ superseded; người được xếp một "Nên biết"; My Workspace sạch; thread chỉ-đọc', async () => {
    const e = await setup({ visibility: 'groups', withX: true });
    const conv = (await OW.call('GET', `/v1/events/${e.id}`)).body.conversationId;
    const r = await OW.call('POST', `/v1/events/${e.id}/cancel`, { expectedVersion: e.version, reason: 'Mưa bão' });
    expect(r.body.status).toBe('cancelled');
    expect(r.body.positions[0].assignments.every((a: { status: string }) => a.status === 'cancelled')).toBe(true);
    await h.dispatch();
    expect((await notes(M2, e.id)).map((n) => [n.class, n.action_state])).toEqual([
      ['action_required', 'superseded'],
      ['direct', 'none'],
    ]);
    // X ngoài nhóm (Event chỉ nhóm thấy) vẫn nhận được thông báo huỷ.
    expect((await notes(X, e.id)).at(-1)).toMatchObject({ class: 'direct', verbs: ['event.cancelled'] });
    const xItem = (await X.call('GET', '/v1/notifications')).body.items.find((n: { class: string; target: { id: string } }) => n.class === 'direct' && n.target.id === e.id);
    expect(xItem).toMatchObject({ available: true, lines: ['OW đã huỷ buổi'] });
    for (const u of [M1, M2]) {
      const w = (await u.call('GET', '/v1/me/workspace')).body;
      expect([...w.needsResponse, ...w.upcoming].some((x: { eventId?: string }) => x.eventId === e.id)).toBe(false);
    }
    const send = await M1.call('POST', `/v1/conversations/${conv}/messages`, { clientMsgId: `c-${Date.now()}-x`, body: 'còn ai không?', mentionIds: [] });
    expect(send.body.error.code).toBe('read_only');
    // Dòng hệ thống về việc huỷ vẫn vào thread chỉ-đọc và hội thoại nhóm (†).
    const msgs = (await M1.call('GET', `/v1/conversations/${conv}/messages`)).body.messages;
    expect(msgs.at(-1)).toMatchObject({ kind: 'system', body: 'OW đã huỷ buổi "Chúa nhật".' });
  });

  it('F7-T9: dời lịch và huỷ đồng thời → một lệnh thành công, lệnh kia version_conflict; không trạng thái trộn', async () => {
    const e = await setup();
    const [a, b] = await Promise.all([
      OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 5), endsAt: at(day, 7) }),
      AD.call('POST', `/v1/events/${e.id}/cancel`, { expectedVersion: e.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = (await h.db.query(`select status, starts_at from app.events where id = $1`, [e.id])).rows[0];
    if (a.status === 200) expect(row.status).toBe('published');
    else expect(row.starts_at.toISOString()).toBe(at(day, 1));
  });

  it('F7-T10: thành viên chung của nhóm không có bản ghi; dòng hệ thống vào hội thoại nhóm', async () => {
    const e = await setup();
    await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 5), endsAt: at(day, 7) });
    await h.dispatch();
    expect(await notes(M3, e.id)).toHaveLength(0);
    const gconv = (await M3.call('GET', `/v1/groups/${sound}/conversation`)).body.id;
    const msgs = (await M3.call('GET', `/v1/conversations/${gconv}/messages`)).body.messages;
    expect(msgs.at(-1).body).toMatch(/^OW đã dời buổi "Chúa nhật":/);
  });

  it('lỗi: dời bản nháp/buổi đã huỷ → invalid_transition; ends ≤ starts → validation_failed; thành viên thường → forbidden', async () => {
    const e = await setup();
    expect((await M1.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 5), endsAt: at(day, 7) })).status).toBe(403);
    expect((await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version, startsAt: at(day, 7), endsAt: at(day, 5) })).body.error.code).toBe('validation_failed');
    await OW.call('POST', `/v1/events/${e.id}/cancel`, { expectedVersion: e.version });
    expect((await OW.call('POST', `/v1/events/${e.id}/reschedule`, { expectedVersion: e.version + 1, startsAt: at(day, 5), endsAt: at(day, 7) })).body.error.code).toBe('invalid_transition');
    const draft = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Nháp', startsAt: at(60, 1), endsAt: at(60, 2) })).body.event;
    expect((await AD.call('POST', `/v1/events/${draft.id}/cancel`, { expectedVersion: draft.version })).body.error.code).toBe('invalid_transition');
  });

  it('đổi visibility org → groups: người mất quyền xem nhận access_changed và mất Subscription', async () => {
    const e = await setup();
    await X.call('PUT', `/v1/subscriptions/event/${e.id}`, { mode: 'follow' });
    h.realtime.sent.length = 0;
    await OW.call('PATCH', `/v1/events/${e.id}`, { expectedVersion: e.version, visibility: 'groups' });
    expect(h.realtime.sent.filter((s) => s.event === 'access_changed').map((s) => s.topic)).toEqual([`user:${X.id}`]);
    expect((await h.db.query(`select 1 from app.subscriptions where user_id = $1 and target_id = $2`, [X.id, e.id])).rowCount).toBe(0);
    expect((await X.call('GET', `/v1/events/${e.id}`)).status).toBe(404);
  });

  it('RLS realtime khớp Backend cho buổi đã huỷ (người có vị trí lúc huỷ vẫn xem được)', async () => {
    const sql = readFileSync(new URL('../../../db/supabase/0005_realtime_event_cancelled.sql', import.meta.url), 'utf8');
    await h.db.query('create schema if not exists rt');
    await h.db.query(sql.slice(sql.indexOf('create or replace function rt.can_view_event'), sql.indexOf('$$;') + 3));
    const e = await setup({ visibility: 'groups', withX: true });
    await OW.call('POST', `/v1/events/${e.id}/cancel`, { expectedVersion: e.version });
    for (const u of [AD, OW, M1, M3, X]) {
      const api = (await u.call('GET', `/v1/events/${e.id}`)).status === 200;
      const rls = (await h.db.query('select rt.can_view_event($1, $2) v', [u.id, e.id])).rows[0].v;
      expect(rls, u.name).toBe(api);
    }
    expect((await X.call('GET', `/v1/events/${e.id}`)).status).toBe(200);
  });
});

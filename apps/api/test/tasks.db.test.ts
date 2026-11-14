import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S10 — Task (F8), Task trong dời lịch/huỷ (F7-T3..T5), gỡ thành viên (F1-T5). */
describe.skipIf(!TEST_DB_URL)('F8: Task', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser;
  let orgId: string, sound: string;
  const at = (d: number, hour: number) => new Date(Date.UTC(2034, 0, d, hour)).toISOString();

  const notes = async (u: TestUser, taskId: string) =>
    (
      await h.db.query(
        `select n.class, n.action_state, (select array_agg(i.verb order by a.seq) from app.notification_items i join app.activity_events a on a.id = i.activity_event_id where i.notification_id = n.id) as verbs
           from app.notifications n where n.user_id = $1 and n.object_id = $2 order by n.created_at`,
        [u.id, taskId],
      )
    ).rows;
  const groupTask = async (by: TestUser, body: Record<string, unknown> = {}) => {
    const r = await by.call('POST', '/v1/tasks', { title: 'Chuẩn bị micro', scope: { type: 'group', groupId: sound }, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    X = await h.user('X');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, M1, M2, M3, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [LD, M1, M2, M3]) await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });
    await h.dispatch();
  });
  afterAll(async () => h?.close());

  it('F8-T1: thành viên thường giao việc nhóm cho M2 → requires_acceptance = true dù gửi false', async () => {
    const t = await groupTask(M1, { ownerId: M2.id, requiresAcceptance: false });
    expect(t).toMatchObject({ requiresAcceptance: true, acceptance: 'pending', owner: { userId: M2.id } });
    await h.dispatch();
    expect(await notes(M2, t.id)).toEqual([expect.objectContaining({ class: 'action_required', action_state: 'pending', verbs: ['task.assigned'] })]);
    // Người tạo không phải owner tự theo dõi.
    expect((await M1.call('GET', `/v1/subscriptions/task/${t.id}`)).body.mode).toBe('follow');
  });

  it('F8-T2: LD giao không cần nhận → M2 "Cần bạn"; mở Task → done', async () => {
    const t = await groupTask(LD, { ownerId: M2.id });
    expect(t).toMatchObject({ requiresAcceptance: false, acceptance: 'none' });
    await h.dispatch();
    expect((await notes(M2, t.id))[0]).toMatchObject({ class: 'action_required', action_state: 'pending' });
    await M2.call('POST', '/v1/notifications/read-target', { type: 'task', id: t.id });
    expect((await notes(M2, t.id))[0]).toMatchObject({ action_state: 'done' });
    const w = (await M2.call('GET', '/v1/me/workspace')).body;
    expect(w.upcoming.some((x: { id: string }) => x.id === t.id)).toBe(true);
  });

  it('F8-T3: M2 từ chối → người giao "Cần bạn: giao lại"; giao lại cho M3 → bản ghi đó done', async () => {
    const t = await groupTask(M1, { ownerId: M2.id });
    expect((await M2.call('GET', '/v1/me/workspace')).body.needsResponse.some((x: { id: string }) => x.id === t.id)).toBe(true);
    const r = await M2.call('POST', `/v1/tasks/${t.id}/respond`, { response: 'decline', reason: 'Bận' });
    expect(r.body).toMatchObject({ acceptance: 'declined', declineReason: 'Bận' });
    await h.dispatch();
    expect(await notes(M1, t.id)).toEqual([expect.objectContaining({ class: 'action_required', action_state: 'pending', verbs: ['task.declined'] })]);
    expect((await M1.call('GET', '/v1/me/workspace')).body.coordinate.declinedTasks).toEqual([expect.objectContaining({ id: t.id, declinedBy: 'M2' })]);
    expect((await notes(M2, t.id))[0]).toMatchObject({ action_state: 'done' });
    await M1.call('POST', `/v1/tasks/${t.id}/assign`, { expectedVersion: r.body.version, ownerId: M3.id });
    await h.dispatch();
    expect((await notes(M1, t.id))[0]).toMatchObject({ action_state: 'done' });
    expect((await notes(M3, t.id))[0]).toMatchObject({ class: 'action_required', action_state: 'pending' });
  });

  it('F8-T4: giao lại M2 → M3 → M2: bản ghi cũ superseded + một "Nên biết"; M3 "Cần bạn"', async () => {
    const t = await groupTask(LD, { ownerId: M2.id, requiresAcceptance: true });
    await h.dispatch();
    await LD.call('POST', `/v1/tasks/${t.id}/assign`, { expectedVersion: t.version, ownerId: M3.id });
    await h.dispatch();
    expect((await notes(M2, t.id)).map((n) => [n.class, n.action_state])).toEqual([
      ['action_required', 'superseded'],
      ['direct', 'none'],
    ]);
    expect(await notes(M3, t.id)).toEqual([expect.objectContaining({ class: 'action_required', action_state: 'pending' })]);
  });

  it('F8-T5: M2 bấm Xong cùng lúc LD giao lại → một lệnh version_conflict, kết quả không lai', async () => {
    const t = await groupTask(LD, { ownerId: M2.id });
    const [a, b] = await Promise.all([
      M2.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: t.version, status: 'done' }),
      LD.call('POST', `/v1/tasks/${t.id}/assign`, { expectedVersion: t.version, ownerId: M3.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = (await h.db.query(`select status, owner_id from app.tasks where id = $1`, [t.id])).rows[0];
    if (a.status === 200) expect(row).toEqual({ status: 'done', owner_id: M2.id });
    else expect(row).toEqual({ status: 'open', owner_id: M3.id });
  });

  it('F8-T6: collaborator đổi status → forbidden; bật needs_help → người giao nhận "Nên biết"', async () => {
    const t = await groupTask(LD, { ownerId: M2.id });
    const c = await M2.call('POST', `/v1/tasks/${t.id}/collaborators`, { add: [M3.id] });
    expect(c.body.collaborators).toEqual([{ userId: M3.id, displayName: 'M3' }]);
    expect((await M3.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: c.body.version, status: 'in_progress' })).status).toBe(403);
    const f = await M3.call('POST', `/v1/tasks/${t.id}/flags`, { needsHelp: true });
    expect(f.body.needsHelp).toBe(true);
    await h.dispatch();
    expect((await notes(LD, t.id)).at(-1)).toMatchObject({ class: 'direct', verbs: ['task.flag_changed'] });
    // collaborator tự rời được, không gỡ được người khác.
    expect((await M3.call('POST', `/v1/tasks/${t.id}/collaborators`, { remove: [M3.id] })).status).toBe(200);
  });

  it('F8-T7: Task private → người ngoài danh sách tham gia not_found; org admin xem được', async () => {
    const t = (await M1.call('POST', '/v1/tasks', { orgId, title: 'Riêng', scope: { type: 'private' }, ownerId: M2.id, requiresAcceptance: false })).body;
    expect(t.requiresAcceptance).toBe(true);
    expect((await X.call('GET', `/v1/tasks/${t.id}`)).status).toBe(404);
    expect((await M3.call('PUT', `/v1/subscriptions/task/${t.id}`, { mode: 'follow' })).status).toBe(404);
    expect((await AD.call('GET', `/v1/tasks/${t.id}`)).status).toBe(200);
    expect((await M2.call('GET', `/v1/tasks/${t.id}`)).body.can).toMatchObject({ respond: true, assign: false });
  });

  it('F8-T8: tự giao cho chính mình → không thông báo nào', async () => {
    const t = await groupTask(M1, { ownerId: M1.id, requiresAcceptance: true });
    expect(t).toMatchObject({ requiresAcceptance: false, acceptance: 'none' });
    await h.dispatch();
    expect((await h.db.query(`select 1 from app.notifications where object_id = $1`, [t.id])).rowCount).toBe(0);
  });

  it('vòng đời: bắt đầu → xong (người giao "Nên biết") → mở lại (chỉ task_manager) → huỷ; thread và dòng hệ thống', async () => {
    const t = await groupTask(LD, { ownerId: M2.id });
    await h.dispatch();
    // Thread mở sau khi tạo: dòng hệ thống chỉ chiếu từ đây (hội thoại phải tồn tại lúc notifier chạy).
    const conv = (await M2.call('POST', `/v1/tasks/${t.id}/conversation`)).body.conversationId;
    let v = (await M2.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: t.version, status: 'in_progress' })).body.version;
    const done = await M2.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: v, status: 'done' });
    expect(done.body).toMatchObject({ status: 'done', completedAt: expect.any(String) });
    await h.dispatch();
    expect((await notes(LD, t.id)).at(-1)).toMatchObject({ class: 'direct', verbs: ['task.completed'] });
    expect((await M2.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: done.body.version, status: 'open' })).status).toBe(403);
    v = (await LD.call('POST', `/v1/tasks/${t.id}/status`, { expectedVersion: done.body.version, status: 'open' })).body.version;
    const c = await LD.call('POST', `/v1/tasks/${t.id}/cancel`, { expectedVersion: v });
    expect(c.body.status).toBe('cancelled');
    expect((await LD.call('POST', `/v1/tasks/${t.id}/cancel`, { expectedVersion: c.body.version })).body.error.code).toBe('invalid_transition');
    await h.dispatch();
    const msgs = (await M3.call('GET', `/v1/conversations/${conv}/messages`)).body.messages.map((m: { body: string }) => m.body);
    expect(msgs).toEqual(['M2 đổi tiến độ: đang làm.', 'M2 đã hoàn thành việc.', 'LD đã mở lại việc.', 'LD đã huỷ việc.']);
    // Người ngoài nhóm không đọc được thread của Task nhóm.
    expect((await X.call('GET', `/v1/conversations/${conv}/messages`)).status).toBe(404);
  });

  it('quyền tạo: Task buổi chỉ người quản lý phạm vi; người được giao phải xem được buổi', async () => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Tĩnh tâm', startsAt: at(5, 1), endsAt: at(5, 3), groupIds: [sound], visibility: 'groups' })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version }).catch(() => undefined);
    expect((await M1.call('POST', '/v1/tasks', { title: 'x', scope: { type: 'event', eventId: ev.id } })).status).toBe(403);
    const bad = await LD.call('POST', '/v1/tasks', { title: 'x', scope: { type: 'event', eventId: ev.id }, ownerId: X.id });
    expect(bad.body.error).toMatchObject({ code: 'validation_failed', fields: { ownerId: 'cannot_view' } });
    expect((await LD.call('POST', '/v1/tasks', { title: 'x', scope: { type: 'group', groupId: sound }, dueOffsetMin: 60 })).body.error.code).toBe('validation_failed');
  });

  describe('Task trong dời lịch / huỷ buổi', () => {
    let ev: { id: string; version: number };
    let rel: { id: string }, abs: { id: string };
    beforeAll(async () => {
      const e = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', startsAt: at(10, 1), endsAt: at(10, 3), groupIds: [sound] })).body.event;
      const pos = (await AD.call('POST', `/v1/events/${e.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1 })).body.positions[0];
      await AD.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: M1.id });
      const v = (await AD.call('GET', `/v1/events/${e.id}`)).body.version;
      await AD.call('POST', `/v1/events/${e.id}/publish`, { expectedVersion: v });
      const a = (await h.db.query(`select id from app.assignments where event_id = $1`, [e.id])).rows[0];
      await M1.call('POST', `/v1/assignments/${a.id}/respond`, { response: 'accept' });
      rel = (await AD.call('POST', '/v1/tasks', { title: 'Thử âm', scope: { type: 'event', eventId: e.id }, ownerId: M1.id, dueOffsetMin: -2880 })).body;
      abs = (await AD.call('POST', '/v1/tasks', { title: 'In bài', scope: { type: 'event', eventId: e.id }, ownerId: M2.id, dueAt: at(8, 0) })).body;
      await M1.call('PUT', `/v1/subscriptions/event/${e.id}`, { mode: 'follow' });
      await h.dispatch();
      ev = { id: e.id, version: (await AD.call('GET', `/v1/events/${e.id}`)).body.version };
      expect(rel.id && abs.id).toBeTruthy();
    });

    it('F7-T3/T4/T5: dời 1 ngày → hạn tương đối dời theo, tuyệt đối giữ và có trong summary; M1 một bản ghi gồm cả ba', async () => {
      const r = await AD.call('POST', `/v1/events/${ev.id}/reschedule`, { expectedVersion: ev.version, startsAt: at(11, 1), endsAt: at(11, 3) });
      expect(r.body.summary).toMatchObject({ reconfirmCount: 1, tasksShifted: 1, tasksAbsoluteDue: [{ id: abs.id, title: 'In bài', dueAt: at(8, 0) }] });
      expect((await M1.call('GET', `/v1/tasks/${rel.id}`)).body.dueAt).toBe(at(9, 1));
      const due = (await h.db.query(`select payload from app.activity_events where verb = 'task.due_changed' and object_id = $1`, [rel.id])).rows[0];
      expect(due.payload).toMatchObject({ by_reschedule: true, after: at(9, 1) });
      await h.dispatch();
      const m1 = (await h.db.query(
        `select n.class, n.object_type, (select array_agg(i.verb order by a.seq) from app.notification_items i join app.activity_events a on a.id = i.activity_event_id where i.notification_id = n.id) verbs
           from app.notifications n where n.user_id = $1 and n.updated_at > now() - interval '1 minute' and 'event.rescheduled' = any(select i.verb from app.notification_items i where i.notification_id = n.id)`,
        [M1.id],
      )).rows;
      expect(m1).toEqual([expect.objectContaining({ class: 'action_required', verbs: ['event.rescheduled', 'assignment.reconfirm_requested', 'task.due_changed'] })]);
      ev.version = r.body.event.version;
    });

    it('huỷ buổi → Task chưa xong bị huỷ, owner nhận một thông báo huỷ', async () => {
      await AD.call('POST', `/v1/events/${ev.id}/cancel`, { expectedVersion: ev.version });
      expect((await h.db.query(`select status from app.tasks where event_id = $1`, [ev.id])).rows.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
      await h.dispatch();
      const m2 = (await h.db.query(
        `select n.class from app.notifications n where n.user_id = $1 and exists (select 1 from app.notification_items i where i.notification_id = n.id and i.verb = 'event.cancelled')`,
        [M2.id],
      )).rows;
      expect(m2).toHaveLength(1);
    });
  });

  it('mẫu buổi sinh Task; sao chép buổi sao chép Task (không người, hạn theo buổi)', async () => {
    const tpl = (await AD.call('POST', `/v1/organizations/${orgId}/templates`, {
      name: 'Lễ', definition: { durationMin: 90, groupIds: [], positions: [], tasks: [{ title: 'Chuẩn bị bánh', dueOffsetMin: -60 }, { title: 'Dọn dẹp', dueOffsetMin: null }] },
    })).body;
    const e = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { templateId: tpl.id, startsAt: at(20, 1) })).body.event;
    const list = (await AD.call('GET', `/v1/events/${e.id}/tasks`)).body;
    expect(list.map((t: { title: string; dueAt: string | null; owner: unknown }) => [t.title, t.dueAt, t.owner])).toEqual([
      ['Chuẩn bị bánh', at(20, 0), null],
      ['Dọn dẹp', null, null],
    ]);
    const c = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { copyFromId: e.id, startsAt: at(27, 1) })).body.event;
    expect((await AD.call('GET', `/v1/events/${c.id}/tasks`)).body.map((t: { dueAt: string | null }) => t.dueAt)).toEqual([at(27, 0), null]);
  });

  it('F1-T5: gỡ M3 đang là owner Task chưa xong → task.assigned về rỗng; người giao "Cần bạn"', async () => {
    const t = await groupTask(LD, { ownerId: M3.id });
    await LD.call('POST', `/v1/tasks/${t.id}/collaborators`, { add: [M1.id] });
    await h.dispatch();
    await AD.call('DELETE', `/v1/organizations/${orgId}/members/${M3.id}`);
    await h.dispatch();
    expect((await LD.call('GET', `/v1/tasks/${t.id}`)).body.owner).toBeNull();
    // Gộp theo nguyên nhân: mục "giao lại" nằm trong bản ghi của member.removed (một bản ghi cho một lần gỡ).
    const item = (await h.db.query(
      `select n.class, n.action_state, i.needs_action from app.notification_items i join app.notifications n on n.id = i.notification_id
        where n.user_id = $1 and i.object_type = 'task' and i.object_id = $2 and i.verb = 'task.assigned' and i.needs_action order by n.created_at desc limit 1`,
      [LD.id, t.id],
    )).rows[0];
    expect(item).toEqual({ class: 'action_required', action_state: 'pending', needs_action: true });
  });

  it('RLS realtime: rt.can_view_task khớp view(task) của Backend', async () => {
    const ev = readFileSync(new URL('../../../db/supabase/0005_realtime_event_cancelled.sql', import.meta.url), 'utf8');
    const sql = readFileSync(new URL('../../../db/supabase/0006_realtime_task.sql', import.meta.url), 'utf8');
    await h.db.query('create schema if not exists rt');
    await h.db.query(ev.slice(ev.indexOf('create or replace function rt.can_view_event'), ev.indexOf('$$;') + 3));
    await h.db.query(sql.slice(sql.indexOf('create or replace function rt.can_view_task'), sql.indexOf('$$;') + 3));
    const ts = (await h.db.query(`select id from app.tasks`)).rows.map((r) => r.id as string);
    for (const id of ts)
      for (const u of [AD, LD, M1, M2, X]) {
        const api = (await u.call('GET', `/v1/tasks/${id}`)).status === 200;
        const rls = (await h.db.query('select rt.can_view_task($1, $2) v', [u.id, id])).rows[0].v;
        expect(rls, `${u.name} ${id}`).toBe(api);
      }
  });
});

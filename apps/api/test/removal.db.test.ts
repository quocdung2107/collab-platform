import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** AD-33: xoá buổi ở mọi trạng thái (ẩn mềm), xoá nhịp kèm buổi, quyền và thông báo. */
describe.skipIf(!TEST_DB_URL)('AD-33: xoá buổi và nhịp', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser;
  let orgId: string, sound: string;
  const day = 24 * 3600_000;

  const newEvent = async (title: string, startsAt: Date, u: TestUser = AD) => {
    const r = await u.call('POST', `/v1/organizations/${orgId}/events`, {
      title,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 3600_000).toISOString(),
      groupIds: [sound],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.event as { id: string; version: number };
  };
  const version = async (id: string) => (await h.db.query<{ version: number }>(`select version from app.events where id = $1`, [id])).rows[0]!.version;
  const publishWith = async (id: string, who: TestUser) => {
    const p = await AD.call('POST', `/v1/events/${id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1 });
    expect((await AD.call('POST', `/v1/positions/${p.body.positions.at(-1).id}/assignments`, { userId: who.id })).status).toBe(201);
    expect((await AD.call('POST', `/v1/events/${id}/publish`, { expectedVersion: await version(id) })).status).toBe(200);
  };
  const remove = (u: TestUser, id: string, v: number) => u.call('DELETE', `/v1/events/${id}`, { expectedVersion: v });

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    M1 = await h.user('M1');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, M1]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
      await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    }
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });
  });
  afterAll(async () => h?.close());

  it('bản nháp lẻ vẫn xoá cứng', async () => {
    const ev = await newEvent('Nháp', new Date(Date.now() + 3 * day));
    const r = await remove(AD, ev.id, ev.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mode: 'hard', notifiedCount: 0 });
    expect((await h.db.query(`select 1 from app.events where id = $1`, [ev.id])).rowCount).toBe(0);
  });

  it('buổi sắp tới đã công bố: huỷ, báo người được xếp, rồi ẩn khỏi mọi nơi', async () => {
    const ev = await newEvent('Thờ phượng', new Date(Date.now() + 5 * day));
    await publishWith(ev.id, M1);
    await h.dispatch();
    // Trưởng nhóm không phải người phụ trách: không được xoá (PERMISSION_MODEL §4.4).
    expect((await remove(LD, ev.id, await version(ev.id))).status).toBe(403);
    expect((await remove(AD, ev.id, (await version(ev.id)) - 1)).status).toBe(409);
    const r = await remove(AD, ev.id, await version(ev.id));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mode: 'soft', notifiedCount: 1 });
    await h.dispatch();

    expect((await AD.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
    expect((await M1.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
    const from = new Date(Date.now() - day).toISOString();
    const to = new Date(Date.now() + 30 * day).toISOString();
    const list = await AD.call('GET', `/v1/organizations/${orgId}/events?from=${from}&to=${to}`);
    expect(list.body.map((e: { id: string }) => e.id)).not.toContain(ev.id);
    const ws = await M1.call('GET', '/v1/me/workspace');
    expect(ws.status).toBe(200);
    expect(JSON.stringify(ws.body)).not.toContain(ev.id);
    // Người được xếp nhận thông báo huỷ; mở lại thấy "không còn khả dụng".
    const inbox = await M1.call('GET', '/v1/notifications');
    const n = inbox.body.items.find((i: { target: { id: string } }) => i.target.id === ev.id);
    expect(n).toMatchObject({ available: false });
    const verbs = await h.db.query<{ verb: string }>(`select verb from app.activity_events where event_id = $1 and cause_id is null order by seq`, [ev.id]);
    expect(verbs.rows.map((x) => x.verb)).toEqual(['event.created', 'position.created', 'event.published', 'event.cancelled', 'event.deleted']);
    // Xoá lần hai: không còn thấy.
    expect((await remove(AD, ev.id, await version(ev.id))).status).toBe(404);
  });

  it('buổi đã qua: ẩn, không báo ai', async () => {
    const ev = await newEvent('Buổi cũ', new Date(Date.now() + 2 * day));
    await publishWith(ev.id, M1);
    await h.db.query(`update app.events set starts_at = starts_at - interval '10 days', ends_at = ends_at - interval '10 days' where id = $1`, [ev.id]);
    await h.dispatch();
    const before = (await h.db.query(`select count(*)::int as n from app.notifications where user_id = $1`, [M1.id])).rows[0].n;
    const r = await remove(AD, ev.id, await version(ev.id));
    expect(r.body).toMatchObject({ mode: 'soft', notifiedCount: 0 });
    await h.dispatch();
    expect((await h.db.query(`select count(*)::int as n from app.notifications where user_id = $1`, [M1.id])).rows[0].n).toBe(before);
    expect((await h.db.query(`select status, deleted_by from app.events where id = $1`, [ev.id])).rows[0]).toEqual({ status: 'published', deleted_by: AD.id });
  });

  it('nhịp tạo trùng: xem trước rồi xoá nhịp kèm mọi buổi; ngày đã xoá không dự kiến lại', async () => {
    const src = await newEvent('Nhóm nhỏ', new Date(Date.now() + 2 * day));
    const s = await AD.call('POST', `/v1/organizations/${orgId}/series/from-events`, { items: [{ eventId: src.id }], untilOn: null });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const seriesId = s.body[0].id as string;
    const fromD = new Date(Date.now()).toISOString().slice(0, 10);
    const toD = new Date(Date.now() + 40 * day).toISOString().slice(0, 10);
    expect((await AD.call('POST', `/v1/organizations/${orgId}/plan/materialize`, { from: fromD, to: toD })).status).toBe(200);
    await publishWith(src.id, M1);

    // Xoá một buổi của nhịp: ngày đó thành "bỏ qua".
    const occ = async () =>
      ((await AD.call('GET', `/v1/organizations/${orgId}/plan?from=${fromD}&to=${toD}`)).body.occurrences as Array<{ seriesId: string; date: string; state: string; eventId: string | null }>).filter(
        (o) => o.seriesId === seriesId,
      );
    const one = (await occ()).find((o) => o.eventId && o.eventId !== src.id)!;
    expect((await remove(AD, one.eventId!, await version(one.eventId!))).body.mode).toBe('soft');
    expect((await occ()).find((o) => o.date === one.date)).toMatchObject({ state: 'skipped', eventId: null });

    const pre = await AD.call('GET', `/v1/series/${seriesId}/removal`);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body).toMatchObject({ upcomingPublished: 1, peopleToNotify: 1, blocked: 0 });
    expect(pre.body.total).toBe(pre.body.drafts + 1);
    // Trưởng nhóm quản lý được nhịp nhưng không phụ trách buổi đã công bố → bị chặn.
    expect((await LD.call('GET', `/v1/series/${seriesId}/removal`)).body.blocked).toBeGreaterThan(0);
    expect((await LD.call('POST', `/v1/series/${seriesId}/archive`, { events: 'all' })).status).toBe(403);

    const r = await AD.call('POST', `/v1/series/${seriesId}/archive`, { events: 'all' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ archived: true, removedEvents: pre.body.total, notifiedCount: 1 });
    const left = await h.db.query(`select 1 from app.events where series_id = $1 and deleted_at is null`, [seriesId]);
    expect(left.rowCount).toBe(0);
    // Mặc định (không gửi body) vẫn chỉ ngừng nhịp như trước.
    const s2 = await AD.call('POST', `/v1/organizations/${orgId}/series/from-events`, { items: [{ eventId: (await newEvent('Cầu nguyện', new Date(Date.now() + 3 * day))).id }], untilOn: null });
    const keep = await AD.call('POST', `/v1/series/${s2.body[0].id}/archive`);
    expect(keep.body).toMatchObject({ archived: true, removedEvents: 0 });
  });
});

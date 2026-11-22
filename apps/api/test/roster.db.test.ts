import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zonedToUtc } from '@collab/shared';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** IN-62: nhập bảng phân công một tháng từ Excel (cột = ngày của nhịp, dòng = vị trí, ô = người). */
describe.skipIf(!TEST_DB_URL)('IN-62: nhập bảng phân công', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, OUT: TestUser;
  let orgId: string, sound: string, seriesId: string, jan6: string;
  const local = (date: string, time: string) => zonedToUtc(date, time, 'Asia/Ho_Chi_Minh').toISOString();

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    OUT = await h.user('OUT');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, M1, M2]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    await AD.call('POST', `/v1/groups/${sound}/members`, { userId: LD.id });
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });

    // Nhịp CN 09:00 có vị trí "Âm thanh" 1 chỗ; buổi 06/01 đã gửi, M1 đã được xếp.
    const s = local('2030-01-06', '09:00');
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Thờ phượng', startsAt: s, endsAt: new Date(Date.parse(s) + 2 * 3600_000).toISOString() })).body.event;
    jan6 = ev.id;
    const pos = (await AD.call('POST', `/v1/events/${jan6}/positions`, { name: 'Âm thanh', slots: 1 })).body.positions[0].id;
    await AD.call('POST', `/v1/positions/${pos}/assignments`, { userId: M1.id });
    const r = await AD.call('POST', `/v1/organizations/${orgId}/series/from-events`, { items: [{ eventId: jan6 }], untilOn: '2030-12-31' });
    seriesId = r.body[0].id;
    const cur = (await AD.call('GET', `/v1/events/${jan6}`)).body;
    expect((await AD.call('POST', `/v1/events/${jan6}/publish`, { expectedVersion: cur.version })).status).toBe(200);
    await h.dispatch();
  });
  afterAll(async () => h?.close());

  const body = (rows: Array<{ name: string; cells: string[][] }>, columns = [{ date: '2030-01-06' }, { date: '2030-01-13' }, { date: '2030-01-14', time: '19:30' }, { date: '2030-01-13' }]) => ({
    seriesId,
    columns,
    rows,
  });

  it('xem trước: khớp vị trí không dấu, cột mới/ngoài nhịp/trùng; buổi đã gửi bị bỏ qua', async () => {
    const b = body([
      { name: 'am thanh', cells: [[M2.id], [M1.id, M2.id], [], []] },
      { name: 'Hướng dẫn', cells: [[M1.id, OUT.id], [], [M2.id], []] },
    ]);
    const r = await AD.call('POST', `/v1/organizations/${orgId}/roster/preview`, b);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.columns.map((c: { state: string; outsideRule: boolean }) => [c.state, c.outsideRule])).toEqual([
      ['published', false],
      ['new', false],
      ['new', true],
      ['duplicate', false],
    ]);
    expect(r.body.columns[2].startsAt).toBe(local('2030-01-14', '19:30'));
    const [sound0, sound1, sound2, sound3] = r.body.cells[0];
    expect(sound0).toBeNull();
    expect(sound1).toMatchObject({ newPosition: false, add: [M1.id, M2.id], slotsBefore: 1, slotsAfter: 2 });
    expect(sound2).toMatchObject({ add: [], slotsAfter: 1 }); // vị trí có trong định nghĩa nhịp, ô trống
    expect(sound3).toBeNull();
    // Người không phải thành viên bị bỏ; dòng mới chỉ tạo vị trí ở ô có người.
    expect(r.body.cells[1][0]).toBeNull();
    expect(r.body.cells[1][1]).toBeNull();
    expect(r.body.cells[1][2]).toMatchObject({ newPosition: true, add: [M2.id], slotsAfter: 1 });
    expect(r.body.totals).toMatchObject({ newEvents: 2, newPositions: 1, added: 3, removed: 0, ignoredColumns: 2, forbiddenCells: 0 });
    // Xem trước không ghi gì.
    expect((await h.db.query(`select count(*)::int as n from app.events where series_id = $1`, [seriesId])).rows[0].n).toBe(1);
  });

  it('quyền: thành viên thường không nhập được; số ô phải khớp số cột', async () => {
    expect((await M1.call('POST', `/v1/organizations/${orgId}/roster/preview`, body([{ name: 'Âm thanh', cells: [[], [], [], []] }]))).status).toBe(403);
    const bad = await AD.call('POST', `/v1/organizations/${orgId}/roster/preview`, body([{ name: 'Âm thanh', cells: [[]] }]));
    expect(bad.status).toBe(400);
    const dup = await AD.call('POST', `/v1/organizations/${orgId}/roster/preview`, body([{ name: 'Âm thanh', cells: [[], [], [], []] }, { name: 'am  THANH', cells: [[], [], [], []] }]));
    expect(dup.body.error.fields.rows).toBe('duplicate_name');
  });

  it('ghi: tạo bản nháp từ nhịp, xếp người, không báo ai, buổi đã gửi không đổi; nhập lại cùng file không đổi gì', async () => {
    const b = body([
      { name: 'am thanh', cells: [[M2.id], [M1.id, M2.id], [], []] },
      { name: 'Hướng dẫn', cells: [[M1.id], [], [M2.id], []] },
    ]);
    const r = await AD.call('POST', `/v1/organizations/${orgId}/roster/import`, b, { 'idempotency-key': 'roster-import-1' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals).toMatchObject({ newEvents: 2, newPositions: 1, added: 3, ignoredColumns: 2 });
    expect(r.body.eventIds).toHaveLength(2);

    const e6 = (await AD.call('GET', `/v1/events/${jan6}`)).body;
    const names6 = e6.positions.map((p: { name: string; slots: number; assignments: Array<{ userId: string; status: string }> }) => [
      p.name,
      p.slots,
      p.assignments.map((a) => `${a.userId === M1.id ? 'M1' : 'M2'}:${a.status}`).sort(),
    ]);
    expect(names6).toEqual([
      ['Âm thanh', 1, ['M1:requested']],
    ]);
    const e13 = (await AD.call('GET', `/v1/events/${r.body.eventIds[0]}`)).body;
    expect(e13).toMatchObject({ status: 'draft', title: 'Thờ phượng', startsAt: local('2030-01-13', '09:00') });
    expect(e13.positions[0].assignments.map((a: { status: string }) => a.status)).toEqual(['draft', 'draft']);
    const e14 = (await AD.call('GET', `/v1/events/${r.body.eventIds[1]}`)).body;
    expect(e14).toMatchObject({ status: 'draft', startsAt: local('2030-01-14', '19:30') });
    expect(e14.positions.map((p: { name: string }) => p.name)).toEqual(['Âm thanh', 'Hướng dẫn']);
    // Buổi ngoài quy tắc vẫn gắn vào nhịp, nên kế hoạch thấy nó là buổi đã tạo.
    const plan = (await AD.call('GET', `/v1/organizations/${orgId}/plan?from=2030-01-01&to=2030-01-31`)).body;
    expect(plan.occurrences.filter((o: { date: string }) => o.date === '2030-01-14')[0]).toMatchObject({ state: 'materialized', eventId: e14.id });

    // Bản nháp không báo ai.
    await h.dispatch();
    expect((await h.db.query(`select count(*)::int as n from app.notifications where user_id = $1`, [M2.id])).rows[0].n).toBe(0);
    expect((await h.db.query(`select count(*)::int as n from app.activity_events where verb = 'roster.imported'`)).rows[0].n).toBe(1);

    const again = await AD.call('POST', `/v1/organizations/${orgId}/roster/import`, b);
    expect(again.body.totals).toMatchObject({ newEvents: 0, newPositions: 0, added: 0, removed: 0 });
  });

  it('nhập lại sửa bản nháp: bỏ người không còn trong ô; buổi đã gửi không đổi', async () => {
    const b = body([{ name: 'Âm thanh', cells: [[], [M2.id], [], []] }]);
    const p = await AD.call('POST', `/v1/organizations/${orgId}/roster/preview`, b);
    expect(p.body.cells[0][0]).toBeNull();
    expect(p.body.cells[0][1]).toMatchObject({ keep: [M2.id], remove: [M1.id] });
    const r = await AD.call('POST', `/v1/organizations/${orgId}/roster/import`, b);
    expect(r.body.totals).toMatchObject({ removed: 1, added: 0 });
    const e13 = (await AD.call('GET', `/v1/events/${r.body.eventIds[0]}`)).body;
    expect(e13.positions[0].assignments.map((a: { userId: string }) => a.userId)).toEqual([M2.id]);
    const e6 = (await AD.call('GET', `/v1/events/${jan6}`)).body;
    expect(e6.positions[0].assignments.map((a: { userId: string }) => a.userId)).toEqual([M1.id]);
  });

  it('trưởng nhóm không tạo được buổi cho nhịp không thuộc nhóm mình', async () => {
    const b = body([{ name: 'Âm thanh', cells: [[LD.id]] }], [{ date: '2030-01-06' }]);
    expect((await LD.call('POST', `/v1/organizations/${orgId}/roster/preview`, b)).status).toBe(403);
  });

  it('trưởng nhóm: sửa được vị trí của nhóm mình ở buổi người khác phụ trách, ô khác bị đánh dấu và bỏ qua', async () => {
    const s = local('2030-02-05', '19:00');
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Tập dượt', startsAt: s, endsAt: new Date(Date.parse(s) + 3600_000).toISOString(), groupIds: [sound] })).body.event;
    await AD.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1 });
    await AD.call('POST', `/v1/events/${ev.id}/positions`, { name: 'Hướng dẫn', slots: 1 });
    const sid = (await AD.call('POST', `/v1/organizations/${orgId}/series/from-events`, { items: [{ eventId: ev.id }], untilOn: '2030-03-31' })).body[0].id;
    const b = { seriesId: sid, columns: [{ date: '2030-02-05' }], rows: [{ name: 'Âm thanh', cells: [[LD.id]] }, { name: 'Hướng dẫn', cells: [[M1.id]] }] };
    const p = await LD.call('POST', `/v1/organizations/${orgId}/roster/preview`, b);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.cells.map((r: Array<{ forbidden: boolean }>) => r[0]!.forbidden)).toEqual([false, true]);
    const r = await LD.call('POST', `/v1/organizations/${orgId}/roster/import`, b);
    expect(r.body.totals).toMatchObject({ added: 1, forbiddenCells: 1 });
    const d = (await AD.call('GET', `/v1/events/${ev.id}`)).body;
    expect(d.positions.map((x: { assignments: unknown[] }) => x.assignments.length)).toEqual([1, 0]);
  });
});

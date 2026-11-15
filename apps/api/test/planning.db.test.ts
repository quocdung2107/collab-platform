import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandRule, utcToZoned, variantFor, zonedToUtc } from '@collab/shared';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** AD-32: hàm thuần của quy tắc lặp và biến thể (không cần cơ sở dữ liệu). */
describe('AD-32: quy tắc lặp, biến thể, múi giờ', () => {
  it('nhịp tuần, cách tuần, thứ n và lần cuối của tháng, hằng năm', () => {
    expect(expandRule({ freq: 'weekly', interval: 1, weekday: 6 }, '2030-01-01', null, '2030-01-01', '2030-01-31')).toEqual(['2030-01-06', '2030-01-13', '2030-01-20', '2030-01-27']);
    expect(expandRule({ freq: 'weekly', interval: 2, weekday: 6 }, '2030-01-06', '2030-02-28', '2030-01-15', '2030-03-31')).toEqual(['2030-01-20', '2030-02-03', '2030-02-17']);
    expect(expandRule({ freq: 'monthly', nth: 5, weekday: 6 }, '2030-01-01', null, '2030-01-01', '2030-04-30')).toEqual(['2030-03-31']);
    expect(expandRule({ freq: 'monthly', nth: -1, weekday: 6 }, '2030-01-01', null, '2030-01-01', '2030-02-28')).toEqual(['2030-01-27', '2030-02-24']);
    expect(expandRule({ freq: 'yearly', month: 2, day: 29 }, '2027-01-01', null, '2027-01-01', '2032-12-31')).toEqual(['2028-02-29', '2032-02-29']);
  });
  it('ngày cụ thể > giai đoạn > thứ n; cùng mức thì biến thể sau thắng', () => {
    const periods = [{ id: 'P', startsOn: '2030-01-01', endsOn: '2030-01-31' }];
    const v = [
      { id: 'n', selector: { kind: 'nth' as const, nth: 1 }, createdAt: '1' },
      { id: 'p', selector: { kind: 'period' as const, periodId: 'P' }, createdAt: '2' },
      { id: 'd', selector: { kind: 'date' as const, date: '2030-01-06' }, createdAt: '0' },
      { id: 'n2', selector: { kind: 'nth' as const, nth: 1 }, createdAt: '3' },
    ];
    expect(variantFor(v, '2030-01-06', periods)?.id).toBe('d');
    expect(variantFor(v, '2030-01-13', periods)?.id).toBe('p');
    expect(variantFor(v, '2030-02-03', periods)?.id).toBe('n2');
    expect(variantFor(v, '2030-02-10', periods)).toBeNull();
  });
  it('giờ địa phương ↔ UTC, kể cả múi có giờ mùa hè', () => {
    expect(zonedToUtc('2030-01-06', '09:00', 'Asia/Ho_Chi_Minh').toISOString()).toBe('2030-01-06T02:00:00.000Z');
    expect(zonedToUtc('2030-07-07', '09:00', 'America/New_York').toISOString()).toBe('2030-07-07T13:00:00.000Z');
    expect(zonedToUtc('2030-01-06', '09:00', 'America/New_York').toISOString()).toBe('2030-01-06T14:00:00.000Z');
    expect(utcToZoned(new Date('2030-01-05T20:30:00Z'), 'Asia/Ho_Chi_Minh')).toEqual({ date: '2030-01-06', time: '03:30' });
  });
});

type Occ = { seriesId: string; date: string; state: string; title: string; startsAt: string; eventId: string | null; conflict: { reason: string } | null };

describe.skipIf(!TEST_DB_URL)('AD-32: Giai đoạn, Nhịp, Biến thể, sửa theo phạm vi', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser;
  let orgId: string, sound: string;
  /** Giờ địa phương (UTC+7) → ISO. */
  const local = (date: string, time: string) => zonedToUtc(date, time, 'Asia/Ho_Chi_Minh').toISOString();
  const newEvent = async (title: string, date: string, time: string, hours = 2) => {
    const s = local(date, time);
    const r = await AD.call('POST', `/v1/organizations/${orgId}/events`, { title, startsAt: s, endsAt: new Date(Date.parse(s) + hours * 3600_000).toISOString(), groupIds: [sound] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.event as { id: string; version: number };
  };
  const plan = async (from: string, to: string, u: TestUser = AD) => {
    const r = await u.call('GET', `/v1/organizations/${orgId}/plan?from=${from}&to=${to}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { series: Array<{ id: string; name: string; version: number; untilOn: string | null; variants: unknown[] }>; periods: Array<{ id: string }>; occurrences: Occ[] };
  };
  const occOf = (p: { occurrences: Occ[] }, seriesId: string) => p.occurrences.filter((o) => o.seriesId === seriesId);

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

  describe('P2: Giai đoạn và ngày đặc biệt', () => {
    it('quản trị và trưởng nhóm tạo được; thành viên thường không; sửa với phiên bản cũ → 409', async () => {
      const r = await AD.call('POST', `/v1/organizations/${orgId}/periods`, { name: 'Mùa Vọng', kind: 'period', startsOn: '2030-12-01', endsOn: '2030-12-24', color: 'violet' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ name: 'Mùa Vọng', startsOn: '2030-12-01', endsOn: '2030-12-24', color: 'violet', version: 1 });
      const sd = await LD.call('POST', `/v1/organizations/${orgId}/periods`, { name: 'Giáng sinh', kind: 'special_day', startsOn: '2030-12-25', endsOn: '2030-12-31' });
      expect(sd.status).toBe(201);
      expect(sd.body.endsOn).toBe('2030-12-25');
      expect((await M1.call('POST', `/v1/organizations/${orgId}/periods`, { name: 'x', kind: 'period', startsOn: '2030-01-01' })).status).toBe(403);
      expect((await M1.call('GET', `/v1/organizations/${orgId}/plan?from=2030-01-01&to=2030-01-31`)).status).toBe(403);
      const bad = await AD.call('POST', `/v1/organizations/${orgId}/periods`, { name: 'x', kind: 'period', startsOn: '2030-02-02', endsOn: '2030-02-01' });
      expect(bad.body.error.fields.endsOn).toBe('before_start');

      const up = await AD.call('PATCH', `/v1/periods/${r.body.id}`, { expectedVersion: 1, endsOn: '2030-12-23' });
      expect(up.body).toMatchObject({ endsOn: '2030-12-23', version: 2 });
      expect((await AD.call('PATCH', `/v1/periods/${r.body.id}`, { expectedVersion: 1, name: 'y' })).status).toBe(409);
      const p = await plan('2030-12-01', '2030-12-31');
      expect(p.periods.map((x) => x.id)).toEqual([r.body.id, sd.body.id]);
      expect((await AD.call('POST', `/v1/periods/${sd.body.id}/archive`)).status).toBe(200);
      expect((await plan('2030-12-01', '2030-12-31')).periods).toHaveLength(1);
      const verbs = await h.db.query(`select verb from app.activity_events where object_type = 'plan_period' order by seq`);
      expect(verbs.rows.map((x) => x.verb)).toEqual(['plan_period.created', 'plan_period.created', 'plan_period.updated', 'plan_period.archived']);
    });
  });

  let sunday: string; // nhịp CN 09:00
  let src: { id: string };

  describe('P3: Nhịp, buổi dự kiến, tạo bản nháp', () => {
    it('"Lặp tuần này": buổi nguồn thành buổi đầu của nhịp, các tuần sau là dự kiến (không lưu)', async () => {
      src = await newEvent('Thờ phượng Chúa Nhật', '2030-01-06', '09:00');
      await AD.call('POST', `/v1/events/${src.id}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1 });
      const r = await AD.call('POST', `/v1/organizations/${orgId}/series/from-events`, { items: [{ eventId: src.id }], untilOn: '2030-03-31' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      sunday = r.body[0].id;
      expect(r.body[0]).toMatchObject({ name: 'Thờ phượng Chúa Nhật', rule: { freq: 'weekly', interval: 1, weekday: 6 }, localTime: '09:00', startsOn: '2030-01-06', canManage: true });
      expect(r.body[0].definition).toMatchObject({ durationMin: 120, groupIds: [sound], positions: [{ name: 'Âm thanh', groupId: sound, slots: 1 }] });

      const p = await plan('2030-01-01', '2030-01-31');
      expect(occOf(p, sunday).map((o) => [o.date, o.state])).toEqual([
        ['2030-01-06', 'materialized'],
        ['2030-01-13', 'projected'],
        ['2030-01-20', 'projected'],
        ['2030-01-27', 'projected'],
      ]);
      expect(occOf(p, sunday)[1]!.startsAt).toBe('2030-01-13T02:00:00.000Z');
      expect((await h.db.query(`select count(*)::int as n from app.events where series_id = $1`, [sunday])).rows[0].n).toBe(1);
    });

    it('"Tạo bản nháp" cho một tháng: tạo bản nháp kèm vị trí; lặp lại không tạo trùng', async () => {
      const r = await AD.call('POST', `/v1/organizations/${orgId}/plan/materialize`, { from: '2030-01-01', to: '2030-01-31' });
      expect(r.body, JSON.stringify(r.body)).toMatchObject({ created: 3, skippedExisting: 1, skippedConflicts: 0 });
      const ev = (await AD.call('GET', `/v1/events/${r.body.eventIds[0]}`)).body;
      expect(ev).toMatchObject({ status: 'draft', title: 'Thờ phượng Chúa Nhật', startsAt: '2030-01-13T02:00:00.000Z', endsAt: '2030-01-13T04:00:00.000Z' });
      expect(ev.positions.map((x: { name: string }) => x.name)).toEqual(['Âm thanh']);
      const again = await AD.call('POST', `/v1/organizations/${orgId}/plan/materialize`, { from: '2030-01-01', to: '2030-01-31' });
      expect(again.body).toMatchObject({ created: 0, skippedExisting: 4 });
      expect((await h.db.query(`select count(*)::int as n from app.activity_events where verb = 'series.materialized'`)).rows[0].n).toBe(1);
    });

    it('nhịp có nhóm Ban Âm thanh: thành viên thường không tạo được; trưởng nhóm thì được', async () => {
      const e = await newEvent('Tập dượt', '2030-01-09', '19:00');
      expect((await M1.call('POST', `/v1/organizations/${orgId}/series`, { rule: { freq: 'weekly', weekday: 2 }, sourceEventId: e.id })).status).toBe(403);
      const r = await LD.call('POST', `/v1/organizations/${orgId}/series`, { rule: { freq: 'weekly', weekday: 2 }, sourceEventId: e.id, untilOn: '2030-01-31' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((await AD.call('POST', `/v1/series/${r.body.id}/archive`)).status).toBe(200);
      expect((await plan('2030-01-01', '2030-01-31')).series.map((s) => s.id)).toEqual([sunday]);
    });
  });

  describe('P4: Biến thể, chỗ trùng, "Lặp tháng này"', () => {
    it('ngày đặc biệt và buổi lẻ trùng giờ → cần quyết; tạo bản nháp bỏ qua; "Giữ cả hai" gỡ cờ; "Bỏ buổi này" → bỏ qua', async () => {
      await AD.call('POST', `/v1/organizations/${orgId}/periods`, { name: 'Tết', kind: 'special_day', startsOn: '2030-02-03' });
      await newEvent('Hội đồng', '2030-02-10', '10:00');
      let p = occOf(await plan('2030-02-01', '2030-02-28'), sunday);
      expect(p.map((o) => [o.date, o.conflict?.reason ?? null])).toEqual([
        ['2030-02-03', 'special_day'],
        ['2030-02-10', 'overlap'],
        ['2030-02-17', null],
        ['2030-02-24', null],
      ]);
      const m = await AD.call('POST', `/v1/organizations/${orgId}/plan/materialize`, { from: '2030-02-01', to: '2030-02-28' });
      expect(m.body).toMatchObject({ created: 2, skippedConflicts: 2 });

      expect((await AD.call('POST', `/v1/series/${sunday}/variants`, { selector: { kind: 'date', date: '2030-02-03' }, action: { type: 'skip' } })).status).toBe(201);
      expect((await AD.call('POST', `/v1/series/${sunday}/variants`, { selector: { kind: 'date', date: '2030-02-10' }, action: { type: 'keep' } })).status).toBe(201);
      p = occOf(await plan('2030-02-01', '2030-02-28'), sunday);
      expect(p.slice(0, 2).map((o) => [o.state, o.conflict])).toEqual([
        ['skipped', null],
        ['projected', null],
      ]);
      // Quyết lại cùng ngày thay quyết định cũ.
      await AD.call('POST', `/v1/series/${sunday}/variants`, { selector: { kind: 'date', date: '2030-02-03' }, action: { type: 'keep' } });
      const s = (await plan('2030-02-01', '2030-02-28')).series.find((x) => x.id === sunday)!;
      expect(s.variants).toHaveLength(2);
    });

    it('thứ n của tháng đổi tên/giờ; ngày cụ thể thắng; xoá biến thể trở về nhịp', async () => {
      const v = await AD.call('POST', `/v1/series/${sunday}/variants`, { selector: { kind: 'nth', nth: 1 }, action: { type: 'override', title: 'Tiệc thánh', localTime: '08:00' } });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      await AD.call('POST', `/v1/series/${sunday}/variants`, { selector: { kind: 'date', date: '2030-03-03' }, action: { type: 'skip' } });
      const p = occOf(await plan('2030-03-01', '2030-03-31'), sunday);
      expect(p.map((o) => [o.date, o.state, o.title])).toEqual([
        ['2030-03-03', 'skipped', 'Thờ phượng Chúa Nhật'],
        ['2030-03-10', 'projected', 'Thờ phượng Chúa Nhật'],
        ['2030-03-17', 'projected', 'Thờ phượng Chúa Nhật'],
        ['2030-03-24', 'projected', 'Thờ phượng Chúa Nhật'],
        ['2030-03-31', 'projected', 'Thờ phượng Chúa Nhật'],
      ]);
      const before = occOf(await plan('2030-01-01', '2030-01-31'), sunday);
      expect(before[0]!.title).toBe('Thờ phượng Chúa Nhật'); // buổi đã tạo giữ nguyên tên của nó
      expect((await AD.call('DELETE', `/v1/variants/${v.body.id}`)).status).toBe(200);
    });

    it('"Lặp tháng này": tuần thành nhịp tuần, lần thứ n thành nhịp tháng hoặc biến thể của nhịp tuần cùng giờ', async () => {
      // Tháng 6/2030: CN 2, 9, 16, 23, 30. CN đầu là Tiệc thánh cùng giờ; T7 thứ hai (8/6) Thanh niên.
      const ids: Record<string, string> = {};
      ids.tt = (await newEvent('Thờ phượng Tiệc thánh', '2030-06-02', '18:00')).id;
      for (const d of ['09', '16', '23', '30']) ids[d] = (await newEvent('Thờ phượng tối', `2030-06-${d}`, '18:00')).id;
      ids.tn = (await newEvent('Thanh niên', '2030-06-08', '15:00')).id;
      const r = await AD.call('GET', `/v1/organizations/${orgId}/plan/month-proposals?month=2030-06`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const props = r.body as Array<{ eventId: string; kind: string; rule: unknown; variantOfEventId: string | null; count: number }>;
      const of = (id: string) => props.find((x) => x.eventId === id)!;
      expect(of(ids.tt!)).toMatchObject({ kind: 'variant', rule: { freq: 'monthly', nth: 1, weekday: 6 }, variantOfEventId: ids['09'] });
      expect(of(ids['09']!)).toMatchObject({ kind: 'weekly', count: 4, rule: { freq: 'weekly', weekday: 6 } });
      expect(of(ids.tn!)).toMatchObject({ kind: 'monthly', rule: { freq: 'monthly', nth: 2, weekday: 5 } });

      const items = [ids.tt, ids['09'], ids.tn].map((id) => {
        const x = of(id!);
        return { eventId: x.eventId, kind: x.kind, rule: x.rule, variantOfEventId: x.variantOfEventId };
      });
      const a = await AD.call('POST', `/v1/organizations/${orgId}/series/from-month`, { items, untilOn: '2030-12-31' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(a.body.series).toHaveLength(2);
      expect(a.body.variants).toHaveLength(1);
      const weekly = a.body.series.find((s: { rule: { freq: string } }) => s.rule.freq === 'weekly').id;
      const monthly = a.body.series.find((s: { rule: { freq: string } }) => s.rule.freq === 'monthly').id;

      const june = await plan('2030-06-01', '2030-06-30');
      expect(occOf(june, weekly).every((o) => o.state === 'materialized')).toBe(true); // 5 buổi cũ đã gắn, không có dự kiến trùng
      expect(occOf(june, weekly)).toHaveLength(5);
      const july = await plan('2030-07-01', '2030-07-31');
      expect(occOf(july, weekly).map((o) => [o.date, o.title])).toEqual([
        ['2030-07-07', 'Thờ phượng Tiệc thánh'],
        ['2030-07-14', 'Thờ phượng tối'],
        ['2030-07-21', 'Thờ phượng tối'],
        ['2030-07-28', 'Thờ phượng tối'],
      ]);
      expect(occOf(july, monthly).map((o) => [o.date, o.startsAt])).toEqual([['2030-07-13', local('2030-07-13', '15:00')]]);
      const again = (await AD.call('GET', `/v1/organizations/${orgId}/plan/month-proposals?month=2030-06`)).body as Array<{ kind: string }>;
      expect(again.every((x) => x.kind === 'covered')).toBe(true);
    });
  });

  describe('P5: sửa Nhịp theo phạm vi', () => {
    let published: { id: string };
    let detached: { id: string };

    it('xem trước ảnh hưởng: bản nháp, buổi đã gửi (kèm số người), buổi đã sửa riêng, buổi dự kiến', async () => {
      const jan = occOf(await plan('2030-01-01', '2030-01-31'), sunday);
      published = { id: jan[1]!.eventId! };
      detached = { id: jan[2]!.eventId! };
      const pub = (await AD.call('GET', `/v1/events/${published.id}`)).body;
      await AD.call('POST', `/v1/positions/${pub.positions[0].id}/assignments`, { userId: M1.id });
      expect((await AD.call('POST', `/v1/events/${published.id}/publish`, { expectedVersion: pub.version })).status).toBe(200);
      const d = (await AD.call('GET', `/v1/events/${detached.id}`)).body;
      expect((await AD.call('PATCH', `/v1/events/${detached.id}`, { expectedVersion: d.version, location: 'Sân sau' })).status).toBe(200);

      const r = await AD.call('POST', `/v1/series/${sunday}/preview`, { scope: 'all', localTime: '10:00' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      // Đã tạo: 6/1, 13/1 (đã gửi), 20/1 (sửa riêng), 27/1, 17/2, 24/2. Dự kiến còn lại tới 31/3: 3/2, 10/2 + 3/3..31/3 (5) = 7.
      expect(r.body).toEqual({ projected: 7, drafts: 4, detached: 1, published: 1, people: 1 });
    });

    it('cả nhịp: bản nháp dời thẳng, buổi đã gửi đi qua Dời lịch, buổi sửa riêng giữ nguyên', async () => {
      const s = (await plan('2030-01-01', '2030-01-31')).series.find((x) => x.id === sunday)!;
      const r = await AD.call('PATCH', `/v1/series/${sunday}`, { expectedVersion: s.version, scope: 'all', localTime: '10:00' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ applied: 5, series: { localTime: '10:00' } });
      const jan = occOf(await plan('2030-01-01', '2030-01-31'), sunday);
      expect(jan.map((o) => utcToZoned(new Date(o.startsAt), 'Asia/Ho_Chi_Minh').time)).toEqual(['10:00', '10:00', '09:00', '10:00']);
      const pub = (await AD.call('GET', `/v1/events/${published.id}`)).body;
      expect(pub.status).toBe('published');
      const rs = await h.db.query(`select verb from app.activity_events where event_id = $1 and verb = 'event.rescheduled'`, [published.id]);
      expect(rs.rowCount).toBe(1);
      const ds = await h.db.query(`select count(*)::int as n from app.events where series_id = $1 and detached_at is not null`, [sunday]);
      expect(ds.rows[0].n).toBe(1); // chỉ buổi sửa tay; buổi đã gửi đổi theo nhịp nên vẫn theo nhịp
      expect((await AD.call('PATCH', `/v1/series/${sunday}`, { expectedVersion: s.version, scope: 'all', localTime: '11:00' })).status).toBe(409);
    });

    it('từ một ngày: tách nhịp, phần trước giữ nguyên, phần sau đổi tên và mang theo biến thể', async () => {
      const s = (await plan('2030-01-01', '2030-01-31')).series.find((x) => x.id === sunday)!;
      const r = await AD.call('PATCH', `/v1/series/${sunday}`, { expectedVersion: s.version, scope: 'from', fromOn: '2030-02-15', name: 'Thờ phượng sáng' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const next = r.body.series.id as string;
      expect(next).not.toBe(sunday);
      expect(r.body.series).toMatchObject({ name: 'Thờ phượng sáng', startsOn: '2030-02-15', untilOn: '2030-03-31' });
      expect(r.body.series.variants).toHaveLength(3);
      const feb = await plan('2030-02-01', '2030-02-28');
      expect(feb.series.find((x) => x.id === sunday)!.untilOn).toBe('2030-02-14');
      expect(occOf(feb, sunday).map((o) => o.date)).toEqual(['2030-02-03', '2030-02-10']);
      expect(occOf(feb, next).map((o) => [o.date, o.state, o.title])).toEqual([
        ['2030-02-17', 'materialized', 'Thờ phượng sáng'],
        ['2030-02-24', 'materialized', 'Thờ phượng sáng'],
      ]);
    });
  });
});

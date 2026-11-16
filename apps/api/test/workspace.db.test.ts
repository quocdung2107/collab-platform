import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S8 — My Workspace (F12). Ngày tương đối với hiện tại vì khối Sắp tới tính 14 ngày tới. */
describe.skipIf(!TEST_DB_URL)('F12: My Workspace', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, NEW: TestUser;
  let orgId: string;
  const groups: string[] = [];
  const inDays = (d: number, hour = 9) => {
    const t = new Date(Date.now() + d * 24 * 3600_000);
    t.setUTCHours(hour, 0, 0, 0);
    return t.toISOString();
  };
  const event = async (title: string, d: number, groupId: string, people: TestUser[], slots = people.length || 1, offset = 0) => {
    const ev = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title, startsAt: inDays(d), endsAt: inDays(d, 11), groupIds: [groupId] })).body.event;
    const pos = (await AD.call('POST', `/v1/events/${ev.id}/positions`, { name: `Vị trí ${title}`, groupId, slots, reportOffsetMin: offset })).body.positions[0];
    for (const p of people) await AD.call('POST', `/v1/positions/${pos.id}/assignments`, { userId: p.id });
    const v = (await AD.call('GET', `/v1/events/${ev.id}`)).body.version;
    await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: v });
    return { ev, pos };
  };
  const ws = async (u: TestUser) => (await u.call('GET', '/v1/me/workspace')).body;
  const asgOf = async (eventId: string, u: TestUser) =>
    (await h.db.query(`select id from app.assignments where event_id = $1 and user_id = $2 and status <> 'cancelled'`, [eventId, u.id])).rows[0].id;

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    M1 = await h.user('M1');
    NEW = await h.user('NEW');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    for (const n of ['Âm thanh', 'Đón tiếp', 'Thiếu nhi']) groups.push((await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: n })).body.id);
    for (const u of [LD, M1, NEW]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const g of groups) await AD.call('POST', `/v1/groups/${g}/members`, { userId: M1.id });
    await AD.call('POST', `/v1/groups/${groups[0]}/members`, { userId: LD.id });
    await AD.call('PATCH', `/v1/groups/${groups[0]}/members/${LD.id}`, { role: 'leader' });
  });
  afterAll(async () => h?.close());

  it('F12-T5: người mới chưa có gì → các khối rỗng, có tổ chức để dẫn tới Lịch', async () => {
    const w = await ws(NEW);
    expect(w).toMatchObject({ needsResponse: [], upcoming: [], news: [], coordinate: null, firstOrgId: orgId });
  });

  it('F12-T2/T3: việc ở 3 nhóm → một danh sách hợp nhất ghi rõ buổi/nhóm; Sắp tới theo giờ có mặt', async () => {
    const a = await event('Thờ phượng', 3, groups[0]!, [M1], 1, -60);
    const b = await event('Đón khách', 2, groups[1]!, [M1]);
    const c = await event('Lớp thiếu nhi', 5, groups[2]!, [M1]);
    let w = await ws(M1);
    expect(w.needsResponse.map((x: { eventTitle: string; groupName: string }) => [x.eventTitle, x.groupName])).toEqual([
      ['Đón khách', 'Đón tiếp'],
      ['Thờ phượng', 'Âm thanh'],
      ['Lớp thiếu nhi', 'Thiếu nhi'],
    ]);
    for (const e of [a, b, c]) await M1.call('POST', `/v1/assignments/${await asgOf(e.ev.id, M1)}/respond`, { response: 'accept' });
    w = await ws(M1);
    expect(w.needsResponse).toEqual([]);
    expect(w.upcoming.map((x: { eventTitle: string }) => x.eventTitle)).toEqual(['Đón khách', 'Thờ phượng', 'Lớp thiếu nhi']);
    expect(w.upcoming[1].reportAt).toBe(inDays(3, 8)); // có mặt trước 60 phút
  });

  it('F12-T1: xoá toàn bộ notifications → Cần phản hồi và Sắp tới vẫn đúng', async () => {
    await event('Cầu nguyện', 4, groups[0]!, [M1]);
    await h.dispatch();
    const before = await ws(M1);
    await h.db.query('delete from app.notifications');
    const after = await ws(M1);
    expect(after.needsResponse).toEqual(before.needsResponse);
    expect(after.upcoming).toEqual(before.upcoming);
  });

  it('Có gì mới: "Nên biết" chưa đọc, tối đa 10, không gồm "Cần bạn"', async () => {
    const g = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Mới' })).body.id;
    await AD.call('POST', `/v1/groups/${g}/members`, { userId: NEW.id });
    await h.dispatch();
    const w = await ws(NEW);
    expect(w.news).toEqual([expect.objectContaining({ class: 'direct', lines: ['AD đã thêm bạn vào nhóm'] })]);
  });

  it('F12-T4: người điều phối thấy vị trí thiếu người; biến mất khi đủ slots', async () => {
    const e = await event('Hội nghị', 6, groups[0]!, [M1], 2);
    let w = await ws(LD);
    expect(w.coordinate.shortPositions).toEqual([expect.objectContaining({ eventId: e.ev.id, positionName: 'Vị trí Hội nghị', slots: 2, filled: 1, eventStatus: 'published' })]);
    await LD.call('POST', `/v1/positions/${e.pos.id}/assignments`, { userId: NEW.id });
    w = await ws(LD);
    expect(w.coordinate.shortPositions.some((p: { eventId: string }) => p.eventId === e.ev.id)).toBe(false);
    // Thành viên thường không có khối Cần xử lý.
    expect((await ws(M1)).coordinate).toBeNull();
  });

  it('mục bị huỷ biến mất: bị gỡ khỏi vị trí → không còn trong My Workspace (F6-T5)', async () => {
    const e = await event('Tĩnh tâm', 7, groups[1]!, [NEW]);
    expect((await ws(NEW)).needsResponse.some((x: { eventId: string }) => x.eventId === e.ev.id)).toBe(true);
    await AD.call('POST', `/v1/assignments/${await asgOf(e.ev.id, NEW)}/replace`, { newUserId: M1.id });
    expect((await ws(NEW)).needsResponse.some((x: { eventId: string }) => x.eventId === e.ev.id)).toBe(false);
  });

  it('UX §4.7 hồ sơ thành viên: nhóm + sắp phục vụ; buổi riêng tư không lộ cho người ngoài; người lạ nhận 404', async () => {
    const pub = await event('Hồ sơ công khai', 3, groups[0]!, [M1]);
    const priv = (await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Họp kín', startsAt: inDays(4), endsAt: inDays(4, 11), groupIds: [groups[1]!], visibility: 'groups' })).body.event;
    const pp = (await AD.call('POST', `/v1/events/${priv.id}/positions`, { name: 'Kín', groupId: groups[1]!, slots: 1 })).body.positions[0];
    await AD.call('POST', `/v1/positions/${pp.id}/assignments`, { userId: M1.id });
    await AD.call('POST', `/v1/events/${priv.id}/publish`, { expectedVersion: (await AD.call('GET', `/v1/events/${priv.id}`)).body.version });
    const url = `/v1/organizations/${orgId}/members/${M1.id}/profile`;
    const asAd = (await AD.call('GET', url)).body;
    expect(asAd.member).toMatchObject({ userId: M1.id, displayName: 'M1', role: 'member' });
    expect(asAd.groups.map((g: { name: string }) => g.name).sort()).toEqual(['Thiếu nhi', 'Âm thanh', 'Đón tiếp'].sort());
    expect(asAd.upcoming.map((u: { eventTitle: string }) => u.eventTitle)).toEqual(expect.arrayContaining(['Hồ sơ công khai', 'Họp kín']));
    // NEW không thuộc nhóm nào và không được xếp: chỉ thấy buổi công khai.
    const asNew = (await NEW.call('GET', url)).body;
    expect(asNew.upcoming.map((u: { eventTitle: string }) => u.eventTitle)).toContain('Hồ sơ công khai');
    expect(asNew.upcoming.map((u: { eventTitle: string }) => u.eventTitle)).not.toContain('Họp kín');
    expect(JSON.stringify(asNew)).not.toMatch(/lý do|reason/i);
    expect(pub.ev.id).toBeTruthy();
    const stranger = await h.user('STRANGER');
    expect((await stranger.call('GET', url)).status).toBe(404);
    expect((await AD.call('GET', `/v1/organizations/${orgId}/members/${stranger.id}/profile`)).status).toBe(404);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { readFileSync } from 'node:fs';
import { TEST_DB_URL } from './db.js';

/** S5 — Event, Position, xếp người (F3, F4, PERMISSION_MODEL §3–4.5). Ký hiệu như MVP_ACCEPTANCE_CRITERIA. */
describe.skipIf(!TEST_DB_URL)('F3/F4: Event, Position, xếp người', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, OW: TestUser, M1: TestUser, M2: TestUser, M3: TestUser, X: TestUser, Z: TestUser;
  let orgId: string, sound: string, welcome: string;
  const at = (dayOffset: number, hour: number) => new Date(Date.UTC(2030, 0, 6 + dayOffset, hour)).toISOString();

  const newEvent = async (u: TestUser, body: Record<string, unknown> = {}) => {
    const r = await u.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Chúa nhật', startsAt: at(0, 1), endsAt: at(0, 3), groupIds: [sound], ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.event;
  };
  const addPosition = async (u: TestUser, eventId: string, body: Record<string, unknown> = {}) => {
    const r = await u.call('POST', `/v1/events/${eventId}/positions`, { name: 'Âm thanh', groupId: sound, slots: 1, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.positions.at(-1);
  };
  const assign = (u: TestUser, positionId: string, user: TestUser) => u.call('POST', `/v1/positions/${positionId}/assignments`, { userId: user.id });
  const publish = async (u: TestUser, eventId: string) => {
    const ev = (await u.call('GET', `/v1/events/${eventId}`)).body;
    return u.call('POST', `/v1/events/${eventId}/publish`, { expectedVersion: ev.version });
  };

  beforeAll(async () => {
    h = await createHarness();
    AD = await h.user('AD');
    LD = await h.user('LD');
    OW = await h.user('OW');
    M1 = await h.user('M1');
    M2 = await h.user('M2');
    M3 = await h.user('M3');
    X = await h.user('X');
    Z = await h.user('Z');
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    sound = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    welcome = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Đón tiếp' })).body.id;
    for (const u of [LD, OW, M1, M2, M3, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [LD, M1, M2]) await AD.call('POST', `/v1/groups/${sound}/members`, { userId: u.id });
    await AD.call('PATCH', `/v1/groups/${sound}/members/${LD.id}`, { role: 'leader' });
    await AD.call('POST', `/v1/groups/${welcome}/members`, { userId: M3.id });
  });
  afterAll(async () => h?.close());

  describe('tạo và quyền tạo', () => {
    it('org admin tạo bản nháp → là event_owner, event.created; ends_at ≤ starts_at → validation_failed', async () => {
      const ev = await newEvent(AD);
      expect(ev).toMatchObject({ status: 'draft', visibility: 'org', canEdit: true, owners: [{ userId: AD.id }] });
      const bad = await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(0, 3), endsAt: at(0, 1) });
      expect(bad.status).toBe(400);
      expect(bad.body.error.fields.endsAt).toBe('before_start');
    });

    it('leader tạo được nếu Event gồm nhóm họ là leader; thành viên thường thì không', async () => {
      expect((await LD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'Tập dượt', startsAt: at(1, 1), endsAt: at(1, 2), groupIds: [sound] })).status).toBe(201);
      expect((await LD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(1, 1), endsAt: at(1, 2), groupIds: [welcome] })).status).toBe(403);
      expect((await M1.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(1, 1), endsAt: at(1, 2), groupIds: [sound] })).status).toBe(403);
      expect((await Z.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(1, 1), endsAt: at(1, 2) })).status).toBe(404);
    });
  });

  describe('F3 bản nháp và publish', () => {
    it('F3-T1: bản nháp có M1 được xếp → M1 không thấy Event, không có sự kiện Assignment', async () => {
      const ev = await newEvent(AD);
      const pos = await addPosition(AD, ev.id);
      expect((await assign(AD, pos.id, M1)).status).toBe(201);
      expect((await M1.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
      const list = await M1.call('GET', `/v1/organizations/${orgId}/events?from=${at(-1, 0)}&to=${at(2, 0)}`);
      expect(list.body.some((e: { id: string }) => e.id === ev.id)).toBe(false);
      const evs = await h.db.query(`select verb from app.activity_events where event_id = $1 and verb like 'assignment.%'`, [ev.id]);
      expect(evs.rowCount).toBe(0);
      // Leader nhóm trong event_groups thấy bản nháp, kể cả Assignment draft của vị trí nhóm mình.
      const asLeader = await LD.call('GET', `/v1/events/${ev.id}`);
      expect(asLeader.body.positions[0].assignments).toHaveLength(1);
    });

    it('F3-T2: publish Event có 5 Assignment → 5 assignment.requested cùng cause_id; hội thoại Event được tạo', async () => {
      const ev = await newEvent(AD);
      const pos = await addPosition(AD, ev.id, { slots: 5, groupId: null, name: 'Đón khách' });
      for (const u of [M1, M2, M3, X, LD]) expect((await assign(AD, pos.id, u)).status).toBe(201);
      h.realtime.sent.length = 0;
      const r = await publish(AD, ev.id);
      expect(r.status).toBe(200);
      expect(r.body.requestedCount).toBe(5);
      expect(r.body.event.status).toBe('published');
      expect(r.body.event.conversationId).toBeTruthy();
      const root = (await h.db.query(`select id from app.activity_events where verb = 'event.published' and event_id = $1`, [ev.id])).rows[0];
      const kids = await h.db.query(`select cause_id, payload from app.activity_events where verb = 'assignment.requested' and event_id = $1`, [ev.id]);
      expect(kids.rowCount).toBe(5);
      expect(new Set(kids.rows.map((k) => k.cause_id))).toEqual(new Set([root.id]));
      for (const u of [M1, M2, M3, X, LD]) {
        expect(h.realtime.sent.some((s) => s.topic === `user:${u.id}` && s.payload.verb === 'assignment.requested')).toBe(true);
      }
      expect((await M1.call('GET', `/v1/events/${ev.id}`)).body.positions[0].assignments[0].status).toBe('requested');
    });

    it('publish lần hai → invalid_transition; expected_version cũ → version_conflict', async () => {
      const ev = await newEvent(AD);
      expect((await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version })).status).toBe(200);
      const again = await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version + 1 });
      expect(again.body.error.code).toBe('invalid_transition');
      const stale = await AD.call('POST', `/v1/events/${ev.id}/publish`, { expectedVersion: ev.version });
      expect(stale.body.error.code).toBe('version_conflict');
    });

    it('F3-T5: hai người điều phối cùng sửa tiêu đề → người lưu sau nhận version_conflict kèm bản mới', async () => {
      const ev = await newEvent(AD);
      await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id] });
      const v = (await OW.call('GET', `/v1/events/${ev.id}`)).body.version;
      const a = await AD.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: v, title: 'Lễ Giáng sinh' });
      const b = await OW.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: v, title: 'Lễ Phục sinh' });
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(b.body.error).toMatchObject({ code: 'version_conflict', current: { title: 'Lễ Giáng sinh', version: v + 1 } });
    });

    it('đã publish: đổi giờ/địa điểm qua PATCH → invalid_transition (dời lịch là F7)', async () => {
      const ev = await newEvent(AD);
      const p = (await publish(AD, ev.id)).body.event;
      const r = await AD.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: p.version, startsAt: at(0, 2) });
      expect(r.body.error.code).toBe('invalid_transition');
      expect((await AD.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: p.version, title: 'Đổi tên' })).status).toBe(200);
    });

    it('xoá bản nháp: xoá cứng Event và ActivityEvent của nó; bản đã publish không xoá được', async () => {
      const ev = await newEvent(AD);
      await addPosition(AD, ev.id);
      const d = await AD.call('DELETE', `/v1/events/${ev.id}`, { expectedVersion: (await AD.call('GET', `/v1/events/${ev.id}`)).body.version });
      expect(d.status).toBe(200);
      expect((await h.db.query(`select 1 from app.activity_events where event_id = $1`, [ev.id])).rowCount).toBe(0);
      expect((await AD.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
      const pub = await newEvent(AD);
      const v = (await publish(AD, pub.id)).body.event.version;
      expect((await AD.call('DELETE', `/v1/events/${pub.id}`, { expectedVersion: v })).body.error.code).toBe('invalid_transition');
    });

    it('người phụ trách: thêm OW; không gỡ được người cuối cùng; thành viên thường không sửa được', async () => {
      const ev = await newEvent(AD);
      const r = await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id], remove: [AD.id] });
      expect(r.body.owners.map((o: { userId: string }) => o.userId)).toEqual([OW.id]);
      const last = await OW.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: r.body.version, remove: [OW.id] });
      expect(last.body.error.fields.remove).toBe('last_owner');
      expect((await OW.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: r.body.version, title: 'OW sửa' })).status).toBe(200);
      const pub = (await publish(OW, ev.id)).body.event;
      expect((await M1.call('PATCH', `/v1/events/${ev.id}`, { expectedVersion: pub.version, title: 'x' })).status).toBe(403);
    });
  });

  describe('F3 mẫu và sao chép', () => {
    it('tạo từ mẫu → Position theo mẫu; F3-T6: nhóm đã lưu trữ bị bỏ qua và được báo', async () => {
      const tmpGroup = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Tạm' })).body.id;
      const t = await AD.call('POST', `/v1/organizations/${orgId}/templates`, {
        name: 'Thờ phượng Chúa nhật',
        definition: {
          durationMin: 120,
          groupIds: [sound, tmpGroup],
          positions: [
            { name: 'Âm thanh chính', groupId: sound, slots: 1, reportOffsetMin: -60 },
            { name: 'Phụ', groupId: tmpGroup, slots: 2, reportOffsetMin: -30 },
          ],
        },
      });
      expect(t.status).toBe(201);
      expect((await LD.call('POST', `/v1/organizations/${orgId}/templates`, { name: 'x', definition: { durationMin: 60 } })).status).toBe(403);
      const g = (await AD.call('GET', `/v1/groups/${tmpGroup}`)).body;
      await AD.call('POST', `/v1/groups/${tmpGroup}/archive`, { expectedVersion: g.version });

      const r = await AD.call('POST', `/v1/organizations/${orgId}/events`, { templateId: t.body.id, startsAt: at(7, 1) });
      expect(r.status).toBe(201);
      expect(r.body.event).toMatchObject({ title: 'Thờ phượng Chúa nhật', templateId: t.body.id, endsAt: at(7, 3), groups: [{ id: sound }] });
      expect(r.body.event.positions.map((p: { name: string; groupId: string | null }) => [p.name, p.groupId])).toEqual([
        ['Âm thanh chính', sound],
        ['Phụ', null],
      ]);
      expect(r.body.warnings).toEqual([{ code: 'archived_group_skipped', detail: 'Ban Tạm' }]);
      const kids = await h.db.query(
        `select count(*)::int n from app.activity_events c join app.activity_events p on p.id = c.cause_id
          where p.verb = 'event.created' and p.object_id = $1 and c.verb = 'position.created'`,
        [r.body.event.id],
      );
      expect(kids.rows[0].n).toBe(2);
    });

    it('sao chép buổi trước: lấy Position, không lấy người — trừ khi "giữ nguyên người" (Assignment draft)', async () => {
      const src = await newEvent(AD, { location: 'Nhà nguyện' });
      const pos = await addPosition(AD, src.id, { slots: 2 });
      await assign(AD, pos.id, M1);
      await assign(AD, pos.id, M2);
      await publish(AD, src.id);

      const plain = await AD.call('POST', `/v1/organizations/${orgId}/events`, { copyFromId: src.id, startsAt: at(7, 1) });
      expect(plain.body.event).toMatchObject({ title: 'Chúa nhật', location: 'Nhà nguyện', copiedFrom: src.id, endsAt: at(7, 3), status: 'draft' });
      expect(plain.body.event.positions[0]).toMatchObject({ name: 'Âm thanh', slots: 2, filled: 0 });

      const keep = await AD.call('POST', `/v1/organizations/${orgId}/events`, { copyFromId: src.id, startsAt: at(14, 1), keepPeople: true });
      const as = keep.body.event.positions[0].assignments;
      expect(as.map((a: { userId: string; status: string }) => [a.userId, a.status]).sort()).toEqual([[M1.id, 'draft'], [M2.id, 'draft']].sort());
      const evs = await h.db.query(`select 1 from app.activity_events where event_id = $1 and verb like 'assignment.%'`, [keep.body.event.id]);
      expect(evs.rowCount).toBe(0);
    });

    it('tạo mẫu từ Event: lấy thời lượng, nhóm, Position', async () => {
      const ev = await newEvent(AD);
      await addPosition(AD, ev.id, { name: 'Máy chiếu', slots: 2, reportOffsetMin: -45 });
      const t = await AD.call('POST', `/v1/events/${ev.id}/template`, { name: 'Từ buổi' });
      expect(t.body.definition).toEqual({
        durationMin: 120,
        groupIds: [sound],
        positions: [{ name: 'Máy chiếu', groupId: sound, slots: 2, reportOffsetMin: -45 }],
        tasks: [],
      });
      expect((await AD.call('GET', `/v1/organizations/${orgId}/templates`)).body.some((x: { id: string }) => x.id === t.body.id)).toBe(true);
      await AD.call('POST', `/v1/templates/${t.body.id}/archive`);
      expect((await AD.call('GET', `/v1/organizations/${orgId}/templates`)).body.some((x: { id: string }) => x.id === t.body.id)).toBe(false);
    });
  });

  describe('F4 Position và xếp người', () => {
    it('F4-T1: slots = 1, OW và LD xếp hai người khác nhau đồng thời → đúng một thành công, người kia position_full', async () => {
      const ev = await newEvent(AD);
      await AD.call('POST', `/v1/events/${ev.id}/owners`, { expectedVersion: ev.version, add: [OW.id] });
      const pos = await addPosition(AD, ev.id);
      await publish(AD, ev.id);
      const [a, b] = await Promise.all([assign(OW, pos.id, M1), assign(LD, pos.id, M2)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('position_full');
      const n = await h.db.query(`select count(*)::int n from app.assignments where position_id = $1 and status <> 'cancelled'`, [pos.id]);
      expect(n.rows[0].n).toBe(1);
    });

    it('F4-T2: xếp cùng một người hai lần → duplicate_assignment', async () => {
      const ev = await newEvent(AD);
      const pos = await addPosition(AD, ev.id, { slots: 3 });
      expect((await assign(AD, pos.id, M1)).status).toBe(201);
      expect((await assign(AD, pos.id, M1)).body.error.code).toBe('duplicate_assignment');
    });

    it('F4-T3: trùng giờ với buổi khác → thành công kèm warnings[overlapping_assignment]', async () => {
      const a = await newEvent(AD, { title: 'Buổi A', startsAt: at(20, 1), endsAt: at(20, 3) });
      const pa = await addPosition(AD, a.id);
      await assign(AD, pa.id, M2);
      await publish(AD, a.id);
      const b = await newEvent(AD, { title: 'Buổi B', startsAt: at(20, 2), endsAt: at(20, 4) });
      const pb = await addPosition(AD, b.id);
      const r = await assign(AD, pb.id, M2);
      expect(r.status).toBe(201);
      expect(r.body.warnings).toEqual([{ code: 'overlapping_assignment', eventId: a.id, title: 'Buổi A', startsAt: at(20, 1) }]);
    });

    it('F4-T4: LD cố sửa / xếp người ở Position của nhóm khác → forbidden', async () => {
      const ev = await newEvent(AD, { groupIds: [sound, welcome] });
      const other = await addPosition(AD, ev.id, { name: 'Đón khách', groupId: welcome });
      const mine = await addPosition(AD, ev.id);
      expect((await assign(LD, other.id, M1)).status).toBe(403);
      expect((await LD.call('PATCH', `/v1/positions/${other.id}`, { expectedVersion: other.version, slots: 3 })).status).toBe(403);
      expect((await LD.call('DELETE', `/v1/positions/${other.id}`)).status).toBe(403);
      expect((await LD.call('POST', `/v1/events/${ev.id}/positions`, { name: 'x', groupId: welcome })).status).toBe(403);
      expect((await assign(LD, mine.id, M1)).status).toBe(201);
      // Chuyển vị trí của mình sang nhóm khác cũng bị chặn.
      expect((await LD.call('PATCH', `/v1/positions/${mine.id}`, { expectedVersion: mine.version, groupId: welcome })).status).toBe(403);
    });

    it('F4-T5: xếp X (không thuộc nhóm nào) vào Event visibility = groups → X thấy Event và thread, không đọc chat nhóm', async () => {
      const ev = await newEvent(AD, { visibility: 'groups' });
      const pos = await addPosition(AD, ev.id);
      await publish(AD, ev.id);
      expect((await X.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
      expect((await assign(AD, pos.id, X)).status).toBe(201);
      const seen = await X.call('GET', `/v1/events/${ev.id}`);
      expect(seen.status).toBe(200);
      expect((await X.call('GET', `/v1/conversations/${seen.body.conversationId}/messages`)).status).toBe(200);
      const groupConv = (await M1.call('GET', `/v1/groups/${sound}/conversation`)).body.id;
      expect((await X.call('GET', `/v1/conversations/${groupConv}/messages`)).status).toBe(404);
    });

    it('xếp người ngoài tổ chức → not_a_member; Event draft → Assignment draft; bỏ người khỏi bản nháp', async () => {
      const ev = await newEvent(AD);
      const pos = await addPosition(AD, ev.id, { slots: 2 });
      expect((await assign(AD, pos.id, Z)).body.error.code).toBe('not_a_member');
      const a = await assign(AD, pos.id, M1);
      expect(a.body.assignment.status).toBe('draft');
      const after = await AD.call('DELETE', `/v1/assignments/${a.body.assignment.id}`);
      expect(after.body.positions[0].filled).toBe(0);
    });

    it('giảm slots dưới số người đã xếp → validation_failed; gỡ Position đã publish → assignment.cancelled (position_removed)', async () => {
      const ev = await newEvent(AD);
      const pos = await addPosition(AD, ev.id, { slots: 2 });
      await assign(AD, pos.id, M1);
      await assign(AD, pos.id, M2);
      await publish(AD, ev.id);
      const cur = (await AD.call('GET', `/v1/events/${ev.id}`)).body.positions[0];
      expect((await AD.call('PATCH', `/v1/positions/${pos.id}`, { expectedVersion: cur.version, slots: 1 })).body.error.fields.slots).toBe('below_filled');
      const r = await AD.call('DELETE', `/v1/positions/${pos.id}`);
      expect(r.body.positions).toHaveLength(0);
      const c = await h.db.query(`select payload from app.activity_events where verb = 'assignment.cancelled' and event_id = $1`, [ev.id]);
      expect(c.rows.map((x) => x.payload.cancel_reason)).toEqual(['position_removed', 'position_removed']);
    });
  });

  describe('view(event) và trường hạn chế', () => {
    it('visibility = groups: thành viên nhóm thấy, thành viên khác không; org admin luôn thấy; người ngoài tổ chức not_found', async () => {
      const ev = await newEvent(AD, { visibility: 'groups' });
      await publish(AD, ev.id);
      expect((await M1.call('GET', `/v1/events/${ev.id}`)).status).toBe(200);
      expect((await M3.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
      expect((await Z.call('GET', `/v1/events/${ev.id}`)).status).toBe(404);
      const missing = await M3.call('GET', '/v1/events/01a1d7cf-0000-7000-8000-000000000000');
      expect((await M3.call('GET', `/v1/events/${ev.id}`)).body).toEqual(missing.body);
    });

    it('lịch: lọc "của tôi" chỉ gồm buổi mình được xếp; đếm đủ/thiếu người', async () => {
      const ev = await newEvent(AD, { title: 'Buổi lịch', startsAt: at(30, 1), endsAt: at(30, 3) });
      const pos = await addPosition(AD, ev.id, { slots: 2 });
      await assign(AD, pos.id, M3);
      await publish(AD, ev.id);
      const range = `from=${at(29, 0)}&to=${at(31, 0)}`;
      const all = (await M3.call('GET', `/v1/organizations/${orgId}/events?${range}`)).body;
      expect(all.find((e: { id: string }) => e.id === ev.id)).toMatchObject({ slotsTotal: 2, slotsFilled: 1, myAssignments: [{ positionName: 'Âm thanh', status: 'requested', reportAt: at(30, 1) }] });
      const mine = (await M1.call('GET', `/v1/organizations/${orgId}/events?${range}&mine=true`)).body;
      expect(mine.some((e: { id: string }) => e.id === ev.id)).toBe(false);
    });
  });

  it('RLS realtime: rt.can_view_event (db/supabase/0004) khớp view(event) của Backend', async () => {
    const sql = readFileSync(new URL('../../../db/supabase/0004_realtime_event.sql', import.meta.url), 'utf8');
    const fn = sql.slice(sql.indexOf('create or replace function rt.can_view_event'), sql.indexOf('$$;') + 3);
    await h.db.query('create schema if not exists rt');
    await h.db.query(fn);
    const draft = await newEvent(AD, { visibility: 'groups' });
    const grp = await newEvent(AD, { visibility: 'groups' });
    const gp = await addPosition(AD, grp.id);
    await publish(AD, grp.id);
    await assign(AD, gp.id, X);
    const org = await newEvent(AD);
    await publish(AD, org.id);
    for (const ev of [draft, grp, org]) {
      for (const u of [AD, LD, OW, M1, M3, X, Z]) {
        const api = (await u.call('GET', `/v1/events/${ev.id}`)).status === 200;
        const rls = (await h.db.query('select rt.can_view_event($1, $2) v', [u.id, ev.id])).rows[0].v;
        expect(rls, `${u.name} @ ${ev.status}/${ev.visibility}`).toBe(api);
      }
    }
  });

  it('F13-T2: lệnh thất bại không ghi ActivityEvent', async () => {
    const before = (await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n;
    await M1.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(1, 1), endsAt: at(1, 2) });
    await AD.call('POST', `/v1/organizations/${orgId}/events`, { title: 'x', startsAt: at(1, 2), endsAt: at(1, 1) });
    expect((await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n).toBe(before);
  });
});

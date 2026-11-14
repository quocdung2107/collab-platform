import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/**
 * Lát cắt F1 + F2 + F14 (MVP_ACCEPTANCE_CRITERIA). Mã kiểm thử ghi trong tên ca.
 * Ký hiệu: AD org admin (owner), LD trưởng nhóm, M1/M2 thành viên, X thành viên không thuộc nhóm, Z người ngoài tổ chức.
 */
describe.skipIf(!TEST_DB_URL)('F1/F2/F14: tổ chức, lời mời, nhóm, phân quyền', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, X: TestUser, Z: TestUser;
  let orgId: string;
  let groupId: string;

  const invite = async (body: Record<string, unknown> = {}) => {
    const r = await AD.call('POST', `/v1/organizations/${orgId}/invites`, body);
    expect(r.status).toBe(201);
    return r.body.token as string;
  };
  const join = async (u: TestUser, body: Record<string, unknown> = {}) => {
    const r = await u.call('POST', `/v1/invites/${await invite(body)}/accept`);
    expect(r.status).toBe(200);
    return r.body;
  };
  const activities = async (verb: string) =>
    (await h.db.query(`select * from app.activity_events where org_id = $1 and verb = $2 order by seq`, [orgId, verb])).rows;

  beforeAll(async () => {
    h = await createHarness();
    [AD, LD, M1, M2, X, Z] = await Promise.all(['AD', 'LD', 'M1', 'M2', 'X', 'Z'].map((n) => h.user(n)));
    const org = await AD.call('POST', '/v1/organizations', { name: 'Hội thánh Ân Điển' });
    expect(org.status).toBe(201);
    expect(org.body.myRole).toBe('owner');
    orgId = org.body.id;
    const g = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' });
    expect(g.status).toBe(201);
    groupId = g.body.id;
    await join(LD, { groupId });
    await join(M1, { groupId });
    await join(M2);
    await join(X);
    expect((await AD.call('PATCH', `/v1/groups/${groupId}/members/${LD.id}`, { role: 'leader' })).status).toBe(200);
  });
  afterAll(async () => h?.close());

  describe('F1 tổ chức và lời mời', () => {
    it('tạo tổ chức → người tạo là owner, có organization.created', async () => {
      expect(await activities('organization.created')).toHaveLength(1);
      const me = await AD.call('GET', '/v1/me');
      expect(me.body.memberships).toEqual([{ orgId, orgName: 'Hội thánh Ân Điển', role: 'owner' }]);
    });

    it('nhận lời mời kèm nhóm → member + thêm vào nhóm, member.joined và group.member_added (cause_id)', async () => {
      const g = await M1.call('GET', `/v1/groups/${groupId}`);
      expect(g.body.myRole).toBe('member');
      const joined = (await activities('member.joined')).find((a) => a.actor_id === M1.id)!;
      const added = (await activities('group.member_added')).find((a) => a.payload.user_id === M1.id)!;
      expect(added.cause_id).toBe(joined.id);
    });

    it('F1-T1: mở liên kết hợp lệ hai lần bởi cùng người → một Membership, không trừ lượt', async () => {
      const token = await invite({ maxUses: 5 });
      const r1 = await M1.call('POST', `/v1/invites/${token}/accept`);
      expect(r1.body.alreadyMember).toBe(true);
      const preview = await M1.call('GET', `/v1/invites/${token}`);
      expect(preview.body).toEqual({ orgName: 'Hội thánh Ân Điển', status: 'valid', alreadyMember: true });
      const n = await h.db.query(`select count(*)::int n from app.memberships where org_id = $1 and user_id = $2`, [orgId, M1.id]);
      expect(n.rows[0].n).toBe(1);
      const list = await AD.call('GET', `/v1/organizations/${orgId}/invites`);
      expect(list.body.find((i: { maxUses: number }) => i.maxUses === 5).usedCount).toBe(0);
    });

    it('F1-T2: max_uses = 1, hai người nhận đồng thời → đúng một người thành công', async () => {
      const [P, Q] = await Promise.all([h.user('P'), h.user('Q')]);
      const token = await invite({ maxUses: 1 });
      const results = await Promise.all([P.call('POST', `/v1/invites/${token}/accept`), Q.call('POST', `/v1/invites/${token}/accept`)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const failed = results.find((r) => r.status === 409)!;
      expect(failed.body.error).toMatchObject({ code: 'state_conflict', current: { inviteStatus: 'used_up' } });
    });

    it('lời mời hết hạn / thu hồi → báo rõ, không tạo Membership', async () => {
      const W = await h.user('W');
      const token = await invite();
      const inv = (await AD.call('GET', `/v1/organizations/${orgId}/invites`)).body[0];
      expect((await AD.call('DELETE', `/v1/organizations/${orgId}/invites/${inv.id}`)).status).toBe(200);
      const r = await W.call('POST', `/v1/invites/${token}/accept`);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toContain('thu hồi');
      expect((await activities('invite.revoked')).length).toBeGreaterThan(0);

      const t2 = await invite();
      await h.db.query(`update app.invites set expires_at = now() - interval '1 minute' where token_hash = encode(sha256($1::bytea), 'hex')`, [t2]);
      const r2 = await W.call('POST', `/v1/invites/${t2}/accept`);
      expect(r2.body.error.current.inviteStatus).toBe('expired');
      const m = await h.db.query(`select 1 from app.memberships where org_id = $1 and user_id = $2`, [orgId, W.id]);
      expect(m.rowCount).toBe(0);
    });

    it('token sai định dạng hoặc không tồn tại → not_found', async () => {
      expect((await Z.call('GET', '/v1/invites/abc')).status).toBe(404);
      expect((await Z.call('POST', `/v1/invites/${'A'.repeat(43)}/accept`)).status).toBe(404);
    });

    it('thành viên thường không tạo được lời mời → forbidden', async () => {
      const r = await M2.call('POST', `/v1/organizations/${orgId}/invites`, {});
      expect(r.status).toBe(403);
    });

    it('F1-T3: gỡ / hạ vai trò owner cuối cùng → bị từ chối', async () => {
      // Không ai khác được gỡ owner: admin không có quyền quản lý owner.
      await AD.call('PATCH', `/v1/organizations/${orgId}/members/${M2.id}`, { role: 'admin' });
      expect((await M2.call('DELETE', `/v1/organizations/${orgId}/members/${AD.id}`)).status).toBe(403);
      // Owner tự hạ vai trò / tự rời khi là owner cuối cùng.
      expect((await AD.call('PATCH', `/v1/organizations/${orgId}/members/${AD.id}`, { role: 'admin' })).status).toBe(403);
      expect((await AD.call('POST', `/v1/organizations/${orgId}/leave`)).status).toBe(403);
      await AD.call('PATCH', `/v1/organizations/${orgId}/members/${M2.id}`, { role: 'member' });
    });

    it('đổi vai trò: admin không cấp được owner; owner cấp được, rồi owner cũ rời được', async () => {
      const R = await h.user('R');
      await join(R);
      await AD.call('PATCH', `/v1/organizations/${orgId}/members/${R.id}`, { role: 'admin' });
      expect((await R.call('PATCH', `/v1/organizations/${orgId}/members/${M2.id}`, { role: 'owner' })).status).toBe(403);
      expect((await AD.call('PATCH', `/v1/organizations/${orgId}/members/${R.id}`, { role: 'owner' })).status).toBe(200);
      expect((await R.call('POST', `/v1/organizations/${orgId}/leave`)).status).toBe(200);
      const roles = await activities('member.role_changed');
      expect(roles.some((a) => a.payload.after === 'owner')).toBe(true);
    });

    it('sửa tổ chức cần expected_version; lệch → version_conflict kèm bản hiện tại', async () => {
      const org = (await AD.call('GET', `/v1/organizations/${orgId}`)).body;
      const ok = await AD.call('PATCH', `/v1/organizations/${orgId}`, { expectedVersion: org.version, reconfirmThresholdMin: 60 });
      expect(ok.body.version).toBe(org.version + 1);
      const stale = await AD.call('PATCH', `/v1/organizations/${orgId}`, { expectedVersion: org.version, name: 'Tên khác' });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({ code: 'version_conflict', current: { reconfirmThresholdMin: 60 } });
      const upd = (await activities('organization.updated'))[0];
      expect(upd.payload.changes.reconfirm_threshold_min).toEqual({ before: 30, after: 60 });
    });

    it('thông tin liên hệ theo contact_visibility (mặc định managers)', async () => {
      const asMember = (await M2.call('GET', `/v1/organizations/${orgId}/members`)).body;
      const asAdmin = (await AD.call('GET', `/v1/organizations/${orgId}/members`)).body;
      const find = (list: Array<{ userId: string; email: string | null }>) => list.find((m) => m.userId === M1.id)!;
      expect(find(asMember).email).toBeNull();
      expect(find(asAdmin).email).toBe('m1@example.com');
    });
  });

  describe('F2 nhóm', () => {
    it('trùng tên nhóm đang hoạt động → validation_failed', async () => {
      const r = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: 'validation_failed', fields: { name: 'duplicate' } });
    });

    it('chỉ org admin tạo nhóm (OD-05 mặc định)', async () => {
      expect((await LD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban mới' })).status).toBe(403);
    });

    it('leader quản lý thành viên; member thường thì không', async () => {
      expect((await LD.call('POST', `/v1/groups/${groupId}/members`, { userId: M2.id })).status).toBe(200);
      expect((await M1.call('DELETE', `/v1/groups/${groupId}/members/${M2.id}`)).status).toBe(403);
      expect((await LD.call('DELETE', `/v1/groups/${groupId}/members/${M2.id}`)).status).toBe(200);
    });

    it('thêm người không thuộc tổ chức → not_a_member', async () => {
      const r = await AD.call('POST', `/v1/groups/${groupId}/members`, { userId: Z.id });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('not_a_member');
    });

    it('F2-T3 / AD-31: gỡ khỏi nhóm → access_changed tới user:{id} và tín hiệu tới group:{id}', async () => {
      await LD.call('POST', `/v1/groups/${groupId}/members`, { userId: M2.id });
      h.realtime.sent.length = 0;
      await LD.call('DELETE', `/v1/groups/${groupId}/members/${M2.id}`);
      expect(h.realtime.sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ topic: `user:${M2.id}`, event: 'access_changed' }),
          expect.objectContaining({ topic: `group:${groupId}`, event: 'activity', payload: expect.objectContaining({ verb: 'group.member_removed' }) }),
        ]),
      );
      // AD-10: tín hiệu không mang nội dung.
      for (const s of h.realtime.sent) expect(Object.keys(s.payload).sort()).toEqual(['activity_id', 'id', 'type', 'verb']);
    });

    it('leader cuối cùng không tự rời được; member rời được', async () => {
      expect((await LD.call('POST', `/v1/groups/${groupId}/leave`)).status).toBe(403);
      await LD.call('POST', `/v1/groups/${groupId}/members`, { userId: M2.id });
      expect((await M2.call('POST', `/v1/groups/${groupId}/leave`)).status).toBe(200);
    });

    it('sửa và lưu trữ nhóm theo version; nhóm lưu trữ không quản lý thành viên được', async () => {
      const g = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Đón tiếp' });
      const upd = await AD.call('PATCH', `/v1/groups/${g.body.id}`, { expectedVersion: 1, description: 'Đón khách' });
      expect(upd.body.version).toBe(2);
      expect((await AD.call('POST', `/v1/groups/${g.body.id}/archive`, { expectedVersion: 1 })).status).toBe(409);
      expect((await AD.call('POST', `/v1/groups/${g.body.id}/archive`, { expectedVersion: 2 })).body.archived).toBe(true);
      expect((await AD.call('POST', `/v1/groups/${g.body.id}/members`, { userId: M1.id })).status).toBe(403);
      // Tên của nhóm đã lưu trữ dùng lại được.
      expect((await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Đón tiếp' })).status).toBe(201);
      const list = await AD.call('GET', `/v1/organizations/${orgId}/groups`);
      expect(list.body.filter((x: { name: string }) => x.name === 'Ban Đón tiếp')).toHaveLength(1);
    });
  });

  describe('F1: gỡ thành viên khỏi tổ chức', () => {
    it('gỡ M1 → khỏi mọi nhóm (sự kiện con), Membership removed, access_changed; M1 mất quyền xem', async () => {
      h.realtime.sent.length = 0;
      const r = await AD.call('DELETE', `/v1/organizations/${orgId}/members/${M1.id}`);
      expect(r.status).toBe(200);
      expect(r.body.groupsLeft).toEqual([groupId]);
      const root = (await activities('member.removed')).find((a) => a.payload.user_id === M1.id)!;
      const child = (await activities('group.member_removed')).find((a) => a.payload.user_id === M1.id && a.cause_id === root.id);
      expect(child).toBeTruthy();
      expect(h.realtime.sent.some((s) => s.topic === `user:${M1.id}` && s.event === 'access_changed')).toBe(true);
      expect((await M1.call('GET', `/v1/organizations/${orgId}`)).status).toBe(404);
      expect((await M1.call('GET', `/v1/groups/${groupId}`)).status).toBe(404);
      expect((await M1.call('GET', '/v1/me')).body.memberships).toEqual([]);
    });

    it('người đã bị gỡ nhận lời mời mới → Membership được kích hoạt lại, không tạo dòng mới', async () => {
      await join(M1);
      const n = await h.db.query(`select status from app.memberships where org_id = $1 and user_id = $2`, [orgId, M1.id]);
      expect(n.rows).toEqual([{ status: 'active' }]);
    });
  });

  describe('F14 truy cập chéo', () => {
    it('F14-T2: người ngoài tổ chức gọi đối tượng của tổ chức → not_found, thân lỗi giống đối tượng không tồn tại', async () => {
      const missing = '01a1d7cf-0000-7000-8000-000000000000';
      const targets = [`/v1/organizations/${orgId}`, `/v1/organizations/${orgId}/members`, `/v1/organizations/${orgId}/groups`, `/v1/groups/${groupId}`];
      const missingTargets = [`/v1/organizations/${missing}`, `/v1/organizations/${missing}/members`, `/v1/organizations/${missing}/groups`, `/v1/groups/${missing}`];
      for (let i = 0; i < targets.length; i++) {
        const a = await Z.call('GET', targets[i]!);
        const b = await Z.call('GET', missingTargets[i]!);
        expect(a.status).toBe(404);
        expect(a.body).toEqual(b.body);
      }
      expect((await Z.call('GET', '/v1/groups/not-a-uuid')).status).toBe(404);
    });

    it('F14-T2: lệnh ghi của người ngoài tổ chức → not_found, không lộ tồn tại', async () => {
      expect((await Z.call('PATCH', `/v1/organizations/${orgId}`, { expectedVersion: 1, name: 'x' })).status).toBe(404);
      expect((await Z.call('POST', `/v1/groups/${groupId}/members`, { userId: Z.id })).status).toBe(404);
      expect((await Z.call('POST', `/v1/organizations/${orgId}/invites`, {})).status).toBe(404);
    });

    it('thành viên tổ chức ngoài nhóm (X) xem được nhóm và danh sách thành viên (view(group) = view(organization))', async () => {
      const g = await X.call('GET', `/v1/groups/${groupId}`);
      expect(g.status).toBe(200);
      expect(g.body.myRole).toBeNull();
    });

    it('vai trò ở tổ chức khác không mang sang', async () => {
      const other = await Z.call('POST', '/v1/organizations', { name: 'Tổ chức B' });
      expect((await AD.call('GET', `/v1/organizations/${other.body.id}`)).status).toBe(404);
      expect((await Z.call('GET', `/v1/organizations/${orgId}/members`)).status).toBe(404);
    });
  });

  describe('Idempotency-Key (EVENT_API_CONTRACTS §4)', () => {
    it('lặp lại cùng khoá → cùng kết quả, không ghi thêm', async () => {
      const headers = { 'idempotency-key': 'create-group-0001' };
      const a = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Kỹ thuật' }, headers);
      const b = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Kỹ thuật' }, headers);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      expect(b.headers['idempotent-replayed']).toBe('true');
      const created = (await activities('group.created')).filter((x) => x.payload.name === 'Ban Kỹ thuật');
      expect(created).toHaveLength(1);
      expect(created[0].request_id).toBe('create-group-0001');
    });

    it('cùng khoá, nội dung khác → validation_failed', async () => {
      const headers = { 'idempotency-key': 'create-group-0002' };
      await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban A' }, headers);
      const r = await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban B' }, headers);
      expect(r.status).toBe(400);
    });

    it('lệnh lỗi không giữ khoá → gửi lại được', async () => {
      const headers = { 'idempotency-key': 'create-group-0003' };
      expect((await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' }, headers)).status).toBe(400);
      const k = await h.db.query(`select 1 from app.idempotency_keys where key = 'create-group-0003'`);
      expect(k.rowCount).toBe(0);
    });
  });

  it('F13-T1 (một phần): mọi thay đổi trong lát cắt đều có ActivityEvent', async () => {
    const verbs = (await h.db.query(`select distinct verb from app.activity_events order by 1`)).rows.map((r) => r.verb);
    expect(verbs).toEqual(
      expect.arrayContaining([
        'organization.created',
        'organization.updated',
        'member.invited',
        'member.joined',
        'member.removed',
        'member.role_changed',
        'invite.revoked',
        'group.created',
        'group.updated',
        'group.archived',
        'group.member_added',
        'group.member_removed',
        'group.member_role_changed',
      ]),
    );
  });
});

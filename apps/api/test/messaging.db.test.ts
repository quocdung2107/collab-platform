import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import { TEST_DB_URL } from './db.js';

/** S4 — hội thoại nhóm (F9, PERMISSION_MODEL §4.3). */
describe.skipIf(!TEST_DB_URL)('F9: hội thoại nhóm', () => {
  let h: Harness;
  let AD: TestUser, LD: TestUser, M1: TestUser, M2: TestUser, X: TestUser, Z: TestUser;
  let orgId: string, groupId: string, convId: string;
  let n = 0;
  const cid = () => `client-msg-${++n}-${Date.now()}`;
  const send = (u: TestUser, body: string, extra: Record<string, unknown> = {}) =>
    u.call('POST', `/v1/conversations/${convId}/messages`, { clientMsgId: cid(), body, ...extra });

  beforeAll(async () => {
    h = await createHarness();
    [AD, LD, M1, M2, X, Z] = await Promise.all([h.user('AD'), h.user('LD'), h.user('M1'), h.user('M2'), h.user('X'), h.user('Z')]);
    orgId = (await AD.call('POST', '/v1/organizations', { name: 'Hội thánh' })).body.id;
    groupId = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Âm thanh' })).body.id;
    for (const u of [LD, M1, M2, X]) {
      const t = (await AD.call('POST', `/v1/organizations/${orgId}/invites`, {})).body.token;
      await u.call('POST', `/v1/invites/${t}/accept`);
    }
    for (const u of [LD, M1, M2]) await AD.call('POST', `/v1/groups/${groupId}/members`, { userId: u.id });
    await AD.call('PATCH', `/v1/groups/${groupId}/members/${LD.id}`, { role: 'leader' });
    const c = await M1.call('GET', `/v1/groups/${groupId}/conversation`);
    expect(c.status).toBe(200);
    convId = c.body.id;
  });
  afterAll(async () => h?.close());

  it('tạo nhóm → có đúng một hội thoại; danh sách Chat chỉ gồm nhóm của mình', async () => {
    const r = await h.db.query(`select count(*)::int n from app.conversations where anchor_type = 'group' and anchor_id = $1`, [groupId]);
    expect(r.rows[0].n).toBe(1);
    const mine = await M1.call('GET', `/v1/organizations/${orgId}/conversations`);
    expect(mine.body.map((c: { id: string }) => c.id)).toEqual([convId]);
    expect((await X.call('GET', `/v1/organizations/${orgId}/conversations`)).body).toEqual([]);
  });

  it('gửi tin → seq tăng, message.created, tín hiệu conversation.message không mang nội dung', async () => {
    h.realtime.sent.length = 0;
    const r = await send(M1, 'Chào cả nhóm');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ seq: 1, body: 'Chào cả nhóm', senderId: M1.id, kind: 'user' });
    const sig = h.realtime.sent.find((s) => s.topic === `conversation:${convId}`)!;
    expect(sig.event).toBe('conversation.message');
    expect(JSON.stringify(sig.payload)).not.toContain('Chào');
    expect(sig.payload).toMatchObject({ conversation_id: convId, seq: 1, verb: 'message.created' });
    const ev = await h.db.query(`select payload, conversation_id, group_id from app.activity_events where verb = 'message.created'`);
    expect(ev.rows[0]).toMatchObject({ conversation_id: convId, group_id: groupId, payload: { seq: 1, sender_id: M1.id } });
  });

  it('F9-T1: gửi lại cùng client_msg_id → một tin, không cấp seq mới', async () => {
    const id = cid();
    const a = await M1.call('POST', `/v1/conversations/${convId}/messages`, { clientMsgId: id, body: 'Một lần' });
    const b = await M1.call('POST', `/v1/conversations/${convId}/messages`, { clientMsgId: id, body: 'Một lần' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const c = await h.db.query(`select count(*)::int n from app.messages where client_msg_id = $1`, [id]);
    expect(c.rows[0].n).toBe(1);
    const page = await M1.call('GET', `/v1/conversations/${convId}/messages`);
    expect(page.body.conversation.lastSeq).toBe(a.body.seq);
  });

  it('F9-T2: nhiều người gửi đồng thời → seq liền mạch, không trùng, thứ tự như nhau', async () => {
    const before = (await M1.call('GET', `/v1/conversations/${convId}/messages`)).body.conversation.lastSeq;
    const rs = await Promise.all([M1, M2, LD, M1, M2, LD].map((u, i) => send(u, `đồng thời ${i}`)));
    const seqs = rs.map((r) => r.body.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6].map((k) => before + k));
    const p1 = (await M1.call('GET', `/v1/conversations/${convId}/messages`)).body.messages.map((m: { id: string }) => m.id);
    const p2 = (await M2.call('GET', `/v1/conversations/${convId}/messages`)).body.messages.map((m: { id: string }) => m.id);
    expect(p1).toEqual(p2);
  });

  it('phân trang theo seq: beforeSeq / afterSeq', async () => {
    const all = (await M1.call('GET', `/v1/conversations/${convId}/messages`)).body;
    const last = all.conversation.lastSeq;
    const older = await M1.call('GET', `/v1/conversations/${convId}/messages?beforeSeq=${last}&limit=2`);
    expect(older.body.messages.map((m: { seq: number }) => m.seq)).toEqual([last - 2, last - 1]);
    expect(older.body.hasMore).toBe(true);
    const newer = await M1.call('GET', `/v1/conversations/${convId}/messages?afterSeq=${last - 1}`);
    expect(newer.body.messages.map((m: { seq: number }) => m.seq)).toEqual([last]);
  });

  it('trả lời: reply_to cùng hội thoại; khác hội thoại → validation_failed', async () => {
    const orig = (await send(M2, 'Ai mang micro?')).body;
    const r = await send(M1, 'Mình mang', { replyToId: orig.id });
    expect(r.body.replyTo).toMatchObject({ id: orig.id, senderName: 'M2', excerpt: 'Ai mang micro?' });
    const g2 = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Đón tiếp' })).body.id;
    await AD.call('POST', `/v1/groups/${g2}/members`, { userId: M1.id });
    const c2 = (await M1.call('GET', `/v1/groups/${g2}/conversation`)).body.id;
    const bad = await M1.call('POST', `/v1/conversations/${c2}/messages`, { clientMsgId: cid(), body: 'x', replyToId: orig.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.replyToId).toBe('other_conversation');
  });

  it('mention: chỉ người đọc được hội thoại; X (ngoài nhóm) → validation_failed', async () => {
    const ok = await send(LD, '@M1 kiểm tra loa', { mentionIds: [M1.id] });
    expect(ok.body.mentions).toEqual([{ userId: M1.id, displayName: 'M1' }]);
    const ev = await h.db.query(`select payload from app.activity_events where object_id = $1`, [ok.body.id]);
    expect(ev.rows[0].payload.mention_ids).toEqual([M1.id]);
    const bad = await send(LD, '@X', { mentionIds: [X.id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.mentionIds).toBe('not_a_reader');
  });

  it('F9-T6 (một phần): sửa tin, thêm mention M2 → message.edited chỉ ghi M2 là mention mới', async () => {
    const m = (await send(LD, '@M1 nhớ đến sớm', { mentionIds: [M1.id] })).body;
    const r = await LD.call('PATCH', `/v1/messages/${m.id}`, { body: '@M1 @M2 nhớ đến sớm', mentionIds: [M1.id, M2.id] });
    expect(r.status).toBe(200);
    expect(r.body.editedAt).not.toBeNull();
    const ev = await h.db.query(`select payload from app.activity_events where verb = 'message.edited' and object_id = $1`, [m.id]);
    expect(ev.rows[0].payload).toMatchObject({ added_mention_ids: [M2.id], removed_mention_ids: [] });
  });

  it('chỉ người gửi sửa được; leader / org admin trong nhóm xoá được tin người khác', async () => {
    const m = (await send(M2, 'tin của M2')).body;
    expect((await M1.call('PATCH', `/v1/messages/${m.id}`, { body: 'sửa trộm' })).status).toBe(403);
    expect((await LD.call('PATCH', `/v1/messages/${m.id}`, { body: 'sửa trộm' })).status).toBe(403);
    expect((await M1.call('DELETE', `/v1/messages/${m.id}`)).status).toBe(403);
    expect((await LD.call('DELETE', `/v1/messages/${m.id}`)).status).toBe(200);
  });

  it('F9-T5 (một phần): xoá tin có mention → nội dung và mention không còn qua API; dòng giữ lại; tín hiệu deleted', async () => {
    const m = (await send(LD, '@M1 bí mật', { mentionIds: [M1.id] })).body;
    h.realtime.sent.length = 0;
    const d = await LD.call('DELETE', `/v1/messages/${m.id}`);
    expect(d.body).toMatchObject({ deleted: true, body: null, mentions: [] });
    const page = (await M1.call('GET', `/v1/conversations/${convId}/messages`)).body.messages;
    const row = page.find((x: { id: string }) => x.id === m.id);
    expect(row).toMatchObject({ deleted: true, body: null, mentions: [] });
    expect(JSON.stringify(page)).not.toContain('bí mật');
    const db = await h.db.query(`select body, body_norm, deleted_by from app.messages where id = $1`, [m.id]);
    expect(db.rows[0]).toEqual({ body: null, body_norm: null, deleted_by: LD.id });
    expect((await h.db.query(`select 1 from app.message_mentions where message_id = $1`, [m.id])).rowCount).toBe(0);
    expect(h.realtime.sent[0]).toMatchObject({ event: 'conversation.message_changed', payload: { change: 'deleted' } });
    // Không sửa / xoá lại được tin đã xoá.
    expect((await LD.call('PATCH', `/v1/messages/${m.id}`, { body: 'hồi sinh' })).status).toBe(403);
  });

  it('danh sách Chat có tin cuối của người dùng; tin đã xoá không lộ nội dung', async () => {
    const a = (await send(M2, 'Tin cuối  để xem trước')).body;
    const row = async () => (await M1.call('GET', `/v1/organizations/${orgId}/conversations`)).body.find((c: { id: string }) => c.id === convId);
    expect((await row()).lastMessage).toEqual({ senderName: 'M2', own: false, preview: 'Tin cuối để xem trước' });
    await M2.call('DELETE', `/v1/messages/${a.id}`);
    expect(JSON.stringify(await row())).not.toContain('xem trước');
  });

  it('đã đọc: số chưa đọc đúng, không lùi, không vượt last_seq', async () => {
    await send(M2, 'tin mới cho M1');
    const list = (await M1.call('GET', `/v1/organizations/${orgId}/conversations`)).body.find((c: { id: string }) => c.id === convId);
    expect(list.unreadCount).toBeGreaterThan(0);
    const r = await M1.call('POST', `/v1/conversations/${convId}/read`, { seq: 999999 });
    expect(r.body).toMatchObject({ unreadCount: 0, lastReadSeq: r.body.lastSeq });
    const back = await M1.call('POST', `/v1/conversations/${convId}/read`, { seq: 1 });
    expect(back.body.lastReadSeq).toBe(r.body.lastSeq);
  });

  it('F14/AD-11: org admin, thành viên ngoài nhóm, người ngoài tổ chức → not_found trên mọi API hội thoại', async () => {
    const m = (await send(M1, 'nội bộ nhóm')).body;
    const g2 = (await AD.call('POST', `/v1/organizations/${orgId}/groups`, { name: 'Ban Thờ phượng' })).body.id;
    for (const u of [X, Z]) {
      expect((await u.call('GET', `/v1/groups/${groupId}/conversation`)).status).toBe(404);
      expect((await u.call('GET', `/v1/conversations/${convId}/messages`)).status).toBe(404);
      expect((await u.call('POST', `/v1/conversations/${convId}/messages`, { clientMsgId: cid(), body: 'x' })).status).toBe(404);
      expect((await u.call('POST', `/v1/conversations/${convId}/read`, { seq: 1 })).status).toBe(404);
      expect((await u.call('PATCH', `/v1/messages/${m.id}`, { body: 'x' })).status).toBe(404);
      expect((await u.call('DELETE', `/v1/messages/${m.id}`)).status).toBe(404);
    }
    // AD là owner nhưng không thuộc Ban Thờ phượng → không đọc hội thoại nhóm đó.
    const c2 = await h.db.query(`select id from app.conversations where anchor_id = $1`, [g2]);
    expect((await AD.call('GET', `/v1/conversations/${c2.rows[0].id}/messages`)).status).toBe(404);
    const missing = await X.call('GET', `/v1/conversations/01a1d7cf-0000-7000-8000-000000000000/messages`);
    expect((await X.call('GET', `/v1/conversations/${convId}/messages`)).body).toEqual(missing.body);
  });

  it('bị gỡ khỏi nhóm → mất quyền đọc ngay', async () => {
    await LD.call('DELETE', `/v1/groups/${groupId}/members/${M2.id}`);
    expect((await M2.call('GET', `/v1/conversations/${convId}/messages`)).status).toBe(404);
    expect((await M2.call('GET', `/v1/organizations/${orgId}/conversations`)).body).toEqual([]);
    await LD.call('POST', `/v1/groups/${groupId}/members`, { userId: M2.id });
    expect((await M2.call('GET', `/v1/conversations/${convId}/messages`)).status).toBe(200);
  });

  it('lưu trữ nhóm → hội thoại chỉ-đọc: đọc được, gửi/sửa → read_only', async () => {
    const m = (await send(M1, 'trước khi lưu trữ')).body;
    const g = (await AD.call('GET', `/v1/groups/${groupId}`)).body;
    expect((await AD.call('POST', `/v1/groups/${groupId}/archive`, { expectedVersion: g.version })).status).toBe(200);
    const page = await M1.call('GET', `/v1/conversations/${convId}/messages`);
    expect(page.status).toBe(200);
    expect(page.body.conversation.readOnly).toBe(true);
    const s = await send(M1, 'sau khi lưu trữ');
    expect(s.status).toBe(409);
    expect(s.body.error.code).toBe('read_only');
    expect((await M1.call('PATCH', `/v1/messages/${m.id}`, { body: 'sửa' })).body.error.code).toBe('read_only');
  });

  it('lệnh hội thoại lỗi không ghi ActivityEvent (F13-T2)', async () => {
    const before = (await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n;
    await send(M1, 'chỉ-đọc');
    await X.call('POST', `/v1/conversations/${convId}/messages`, { clientMsgId: cid(), body: 'x' });
    expect((await h.db.query(`select count(*)::int n from app.activity_events`)).rows[0].n).toBe(before);
  });
});

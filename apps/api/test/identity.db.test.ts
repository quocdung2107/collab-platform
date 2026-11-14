import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { withTx, type Db } from '../src/db/pool.js';
import { loadActorContext } from '../src/modules/access/context.js';
import { recordActivity } from '../src/modules/activity/record.js';
import { provisionUser } from '../src/modules/identity/users.js';
import { freshDb, TEST_DB_URL } from './db.js';

describe.skipIf(!TEST_DB_URL)('DB: migration + danh tính', () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => db?.end());

  it('migrate lần hai không chạy lại gì', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('uuid_v7 sắp xếp theo thời gian và đúng phiên bản', async () => {
    const r = await db.query<{ a: string; b: string }>('select app.uuid_v7() a, pg_sleep(0.002), app.uuid_v7() b');
    const { a, b } = r.rows[0]!;
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });

  it('provisionUser tạo một lần, lần sau trả lại cùng người dùng', async () => {
    const id = { subject: 'google|1', email: 'a@example.com', displayName: 'An' };
    const u1 = await provisionUser(db, id);
    const u2 = await provisionUser(db, { ...id, displayName: 'Tên khác' });
    expect(u2.id).toBe(u1.id);
    expect(u2.display_name).toBe('An');
  });

  it('provisionUser không vỡ khi email đã thuộc danh tính khác', async () => {
    const u = await provisionUser(db, { subject: 'google|2', email: 'a@example.com', displayName: null });
    expect(u.email).toBeNull();
    expect(u.display_name).toBe('a');
  });

  it('loadActorContext + activity_events trong cùng giao dịch', async () => {
    const owner = await provisionUser(db, { subject: 'google|3', email: null, displayName: 'Chủ' });
    const orgId = await withTx(db, async (tx) => {
      const o = await tx.query<{ id: string }>(`insert into app.organizations (name) values ('Hội thánh A') returning id`);
      const orgId = o.rows[0]!.id;
      await tx.query(`insert into app.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, owner.id]);
      const g = await tx.query<{ id: string }>(
        `insert into app.groups (org_id, name, name_norm, created_by) values ($1, 'Ban hát', 'ban hat', $2) returning id`,
        [orgId, owner.id],
      );
      await tx.query(
        `insert into app.group_members (group_id, user_id, org_id, role, added_by) values ($1, $2, $3, 'leader', $2)`,
        [g.rows[0]!.id, owner.id, orgId],
      );
      await recordActivity(tx, {
        orgId,
        verb: 'organization.created',
        actor: { type: 'user', id: owner.id },
        object: { type: 'organization', id: orgId },
        payload: { name: 'Hội thánh A' },
      });
      return orgId;
    });

    const ctx = await loadActorContext(db, owner.id, orgId);
    expect(ctx.orgRole).toBe('owner');
    expect([...ctx.groupRoles.values()]).toEqual(['leader']);

    const stranger = await provisionUser(db, { subject: 'google|4', email: null, displayName: 'Lạ' });
    expect((await loadActorContext(db, stranger.id, orgId)).orgRole).toBeNull();

    const ev = await db.query(`select verb, actor_type from app.activity_events where org_id = $1`, [orgId]);
    expect(ev.rows).toEqual([{ verb: 'organization.created', actor_type: 'user' }]);
  });

  it('activity_events bị rollback cùng lệnh lỗi (không có sự kiện cho thay đổi bị huỷ)', async () => {
    const before = await db.query(`select count(*)::int n from app.activity_events`);
    await expect(
      withTx(db, async (tx) => {
        const o = await tx.query<{ id: string }>(`insert into app.organizations (name) values ('B') returning id`);
        await recordActivity(tx, {
          orgId: o.rows[0]!.id,
          verb: 'organization.created',
          actor: { type: 'system' },
          object: { type: 'organization', id: o.rows[0]!.id },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await db.query(`select count(*)::int n from app.activity_events`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

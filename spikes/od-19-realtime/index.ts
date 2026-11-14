// Thử nghiệm OD-19: quyền kênh Realtime riêng khi thành viên bị gỡ khỏi nhóm lúc đang kết nối.
// Chạy như Supabase Edge Function (Deno) để kết nối Realtime từ trong hạ tầng Supabase.
// Gọi một lần bằng token dùng-một-lần trong spike.runs; tự dọn người dùng và dữ liệu thử.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import postgres from 'npm:postgres@3.4.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DB_URL = Deno.env.get('SUPABASE_DB_URL')!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
type Log = { t: number; who: string; what: string; detail?: unknown };

Deno.serve(async (req) => {
  const sql = postgres(DB_URL, { prepare: false, max: 2 });
  const log: Log[] = [];
  const note = (who: string, what: string, detail?: unknown) => log.push({ t: Date.now() - t0, who, what, detail });
  const created: { authIds: string[]; orgId?: string } = { authIds: [] };
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { token } = await req.json().catch(() => ({ token: '' }));
    const ok = await sql`update spike.runs set used_at = now() where token = ${token} and used_at is null returning token`;
    if (ok.length === 0) return new Response('forbidden', { status: 403 });

    // 1. Ba người dùng thử: A (ở lại), B (bị gỡ), C (không thuộc nhóm).
    const users: Record<string, { client: SupabaseClient; authId: string; appId: string }> = {};
    for (const who of ['A', 'B', 'C']) {
      const email = `od19-${crypto.randomUUID().slice(0, 8)}-${who.toLowerCase()}@example.com`;
      const password = crypto.randomUUID();
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw new Error(`createUser ${who}: ${error.message}`);
      created.authIds.push(data.user.id);
      const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const s = await client.auth.signInWithPassword({ email, password });
      if (s.error) throw new Error(`signIn ${who}: ${s.error.message}`);
      await client.realtime.setAuth(s.data.session!.access_token);
      const [u] = await sql`insert into app.users (auth_subject, display_name) values (${data.user.id}, ${'OD19 ' + who}) returning id`;
      users[who] = { client, authId: data.user.id, appId: u.id };
    }
    const [org] = await sql`insert into app.organizations (name) values ('OD-19 spike') returning id`;
    created.orgId = org.id;
    for (const who of ['A', 'B', 'C'])
      await sql`insert into app.memberships (org_id, user_id, role) values (${org.id}, ${users[who].appId}, ${who === 'A' ? 'owner' : 'member'})`;
    const [grp] = await sql`insert into app.groups (org_id, name, name_norm, created_by) values (${org.id}, 'Ban thử', 'ban thu', ${users.A.appId}) returning id`;
    for (const who of ['A', 'B'])
      await sql`insert into app.group_members (group_id, user_id, org_id, role, added_by) values (${grp.id}, ${users[who].appId}, ${org.id}, 'member', ${users.A.appId})`;
    const topic = `group:${grp.id}`;

    // 2. Đăng ký kênh riêng.
    const subscribe = (who: string, t: string) =>
      new Promise<string>((resolve) => {
        const ch = users[who].client.channel(t, { config: { private: true } });
        ch.on('broadcast', { event: '*' }, (m) => note(who, `recv ${t}`, m.payload));
        ch.on('system', {}, (m) => note(who, `system ${t}`, m));
        ch.subscribe((status, err) => {
          note(who, `status ${t}: ${status}`, err?.message);
          if (status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return;
          resolve(status);
        });
        setTimeout(() => resolve('NO_RESPONSE'), 8000);
      });
    const send = async (label: string, t = topic) => {
      note('server', `send ${label} → ${t}`);
      await sql`select realtime.send(${sql.json({ label })}, 'activity', ${t}, true)`;
    };

    const joined = {
      A: await subscribe('A', topic),
      B: await subscribe('B', topic),
      C: await subscribe('C', topic),
      B_user: await subscribe('B', `user:${users.B.appId}`),
    };
    await sleep(1000);

    // S1: cả A, B đều nhận; C không vào được.
    await send('m1-before-removal');
    await sleep(2500);

    // S2: gỡ B khỏi nhóm khi đang kết nối, gửi ngay.
    await sql`delete from app.group_members where group_id = ${grp.id} and user_id = ${users.B.appId}`;
    note('server', 'B removed from group');
    await send('m2-right-after-removal');
    await send('access_changed', `user:${users.B.appId}`);
    await sleep(2500);

    // S3: sau 5 giây.
    await sleep(5000);
    await send('m3-after-5s');
    await sleep(2500);

    // S4: B làm mới JWT và gửi token mới cho Realtime (không đăng ký lại kênh).
    const r = await users.B.client.auth.refreshSession();
    note('B', 'refreshSession', r.error?.message ?? 'ok');
    await users.B.client.realtime.setAuth(r.data.session?.access_token ?? null);
    await sleep(2500);
    await send('m4-after-B-token-refresh');
    await sleep(2500);

    // S5: B đăng ký lại kênh nhóm.
    const bCh = users.B.client.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (bCh) await users.B.client.removeChannel(bCh);
    const rejoin = await subscribe('B', topic);
    await send('m5-after-B-rejoin');
    await sleep(2500);

    for (const u of Object.values(users)) await u.client.removeAllChannels();
    const received = (who: string) =>
      log.filter((l) => l.who === who && l.what.startsWith('recv') && l.what.includes('group:')).map((l) => (l.detail as { label: string }).label);
    return Response.json({ joined, rejoin_B: rejoin, received: { A: received('A'), B: received('B'), C: received('C') }, log });
  } catch (e) {
    return Response.json({ error: String(e), log }, { status: 500 });
  } finally {
    if (created.orgId) {
      await sql`delete from app.group_members where org_id = ${created.orgId}`;
      await sql`delete from app.groups where org_id = ${created.orgId}`;
      await sql`delete from app.memberships where org_id = ${created.orgId}`;
      await sql`delete from app.organizations where id = ${created.orgId}`;
    }
    await sql`delete from app.users where display_name like 'OD19 %'`;
    for (const id of created.authIds) await admin.auth.admin.deleteUser(id);
    await sql.end();
  }
});

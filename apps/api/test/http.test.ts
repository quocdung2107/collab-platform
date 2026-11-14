import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { buildApp } from '../src/http/app.js';
import { supabaseVerifier } from '../src/http/auth.js';
import { MemoryRealtime } from '../src/modules/realtime/publisher.js';
import { freshDb, TEST_DB_URL } from './db.js';

const SUPABASE_URL = 'https://test.supabase.co';
const ISS = `${SUPABASE_URL}/auth/v1`;

describe.skipIf(!TEST_DB_URL)('HTTP: xác thực JWT Supabase (khoá bất đối xứng) + /v1/me', () => {
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;

  beforeAll(async () => {
    db = await freshDb();
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    sign = (claims, o = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(o.iss ?? ISS)
        .setAudience(o.aud ?? 'authenticated')
        .setIssuedAt()
        .setExpirationTime(o.exp ?? '5m')
        .sign(privateKey);
    app = await buildApp({
      db,
      verifyToken: supabaseVerifier(SUPABASE_URL, createLocalJWKSet({ keys: [jwk] })),
      realtime: new MemoryRealtime(),
      webOrigins: ['http://localhost:5173'],
    });
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('/healthz công khai', async () => {
    const r = await app.inject({ url: '/healthz' });
    expect(r.statusCode).toBe(200);
  });

  it('thiếu token → 401 unauthenticated', async () => {
    const r = await app.inject({ url: '/v1/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('unauthenticated');
  });

  it.each([
    ['sai issuer', { iss: 'https://other.supabase.co/auth/v1' }],
    ['sai audience', { aud: 'anon' }],
    ['hết hạn', { exp: '-1m' }],
  ])('token %s → 401', async (_n, opts) => {
    const token = await sign({ sub: 'x' }, opts);
    const r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(401);
  });

  it('token hợp lệ → tạo người dùng nội bộ và trả /v1/me', async () => {
    const token = await sign({ sub: 'sb-uuid-1', email: 'Dung@Example.com', user_metadata: { full_name: 'Dũng' } });
    const r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      user: { displayName: 'Dũng', email: 'dung@example.com', locale: 'vi' },
      memberships: [],
    });
  });
});

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Db } from '../src/db/pool.js';
import { buildApp } from '../src/http/app.js';
import { supabaseVerifier } from '../src/http/auth.js';
import { dispatchPending } from '../src/modules/notifications/notifier.js';
import { MemoryRealtime } from '../src/modules/realtime/publisher.js';
import { MemoryStorage } from '../src/modules/files/storage.js';
import { freshDb } from './db.js';

export const SUPABASE_URL = 'https://test.supabase.co';
export const ISS = `${SUPABASE_URL}/auth/v1`;

/** Ứng dụng thật trên Postgres kiểm thử, JWT ký bằng khoá ES256 cục bộ, realtime ghi vào bộ nhớ. */
export async function createHarness() {
  const db: Db = await freshDb();
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const realtime = new MemoryRealtime();
  const storage = new MemoryStorage();
  const app = await buildApp({
    db,
    verifyToken: supabaseVerifier(SUPABASE_URL, createLocalJWKSet({ keys: [jwk] })),
    realtime,
    webOrigins: ['http://localhost:5173'],
    storage,
  });

  const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(o.iss ?? ISS)
      .setAudience(o.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(privateKey);

  /** Một người dùng thử; lần gọi đầu tạo users nội bộ qua /v1/me. */
  async function user(name: string) {
    const token = await sign({ sub: `sub-${name}`, email: `${name.toLowerCase()}@example.com`, user_metadata: { full_name: name } });
    const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await app.inject({ method, url, payload: body as object | undefined, headers: { authorization: `Bearer ${token}`, ...headers } });
      return { status: r.statusCode, body: r.body ? (r.json() as any) : null, headers: r.headers };
    };
    const me = await call('GET', '/v1/me');
    return { name, id: me.body.user.id as string, token, call };
  }

  /** Chạy notifier tới khi outbox rỗng; lỗi xử lý sự kiện làm kiểm thử thất bại. */
  const dispatch = () =>
    dispatchPending(db, realtime, {
      onError: (e) => {
        throw e;
      },
    });

  return { app, db, realtime, storage, sign, user, dispatch, close: async () => (await app.close(), await db.end()) };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
export type TestUser = Awaited<ReturnType<Harness['user']>>;

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from './errors.js';

/**
 * Xác thực JWT Supabase cục bộ bằng JWKS (PERMISSION_MODEL phụ lục §2): không gọi Supabase mỗi yêu cầu.
 * Yêu cầu dự án Supabase dùng khoá ký BẤT ĐỐI XỨNG; khoá HS256 dùng chung không có trong JWKS.
 * Đây là adapter duy nhất biết về định dạng token của nhà cung cấp (AD-26, AD-29).
 */
export interface AuthIdentity {
  subject: string;
  email: string | null;
  displayName: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthIdentity>;

export function supabaseVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey): TokenVerifier {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' }));
    } catch {
      throw new AppError('unauthenticated', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (!payload.sub) throw new AppError('unauthenticated', 'Token thiếu sub');
    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null,
      displayName: name?.trim() ?? null,
    };
  };
}

export function bearerToken(header: string | undefined): string {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) throw new AppError('unauthenticated', 'Thiếu Authorization: Bearer <token>');
  return m[1];
}

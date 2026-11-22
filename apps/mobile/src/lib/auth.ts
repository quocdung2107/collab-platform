import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

/** collab://auth-callback — phải có trong Supabase → Authentication → URL Configuration → Redirect URLs. */
export const authRedirect = makeRedirectUri({ scheme: 'collab', path: 'auth-callback' });

/**
 * Google qua trình duyệt hệ thống (ASWebAuthenticationSession / Custom Tabs), PKCE.
 * Không dùng WebView: Google chặn đăng nhập trong WebView nhúng (cùng lý do với OD-18).
 */
export async function signInWithGoogle(): Promise<'ok' | 'cancel'> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authRedirect, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const res = await WebBrowser.openAuthSessionAsync(data.url, authRedirect);
  if (res.type !== 'success') return 'cancel';
  const url = new URL(res.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error_description');
  if (err) throw new Error(err);
  if (!code) throw new Error('Không nhận được mã đăng nhập.');
  const { error: e2 } = await supabase.auth.exchangeCodeForSession(code);
  if (e2) throw e2;
  return 'ok';
}

/** Sign in with Apple (bắt buộc trên iOS theo điều 4.8 khi có Google). Chỉ iOS; Android ẩn nút. */
export const appleAvailable = () => (Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false));

export async function signInWithApple(): Promise<'ok' | 'cancel'> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!cred.identityToken) throw new Error('Apple không trả về identity token.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken });
    if (error) throw error;
    // Apple chỉ gửi họ tên ở lần đầu → lưu ngay vào hồ sơ Supabase.
    const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ');
    if (name) await supabase.auth.updateUser({ data: { full_name: name } });
    return 'ok';
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancel';
    throw e;
  }
}

export const signOut = () => supabase.auth.signOut();

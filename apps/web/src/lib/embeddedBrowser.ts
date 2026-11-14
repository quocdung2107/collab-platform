/**
 * OD-18: Google chặn đăng nhập OAuth trong WebView nhúng (lỗi 403 disallowed_useragent).
 * Liên kết chia sẻ qua Zalo/Messenger thường mở trong trình duyệt nhúng của ứng dụng đó.
 * Phát hiện theo User-Agent là heuristic: danh sách cần kiểm chứng trên thiết bị thật (Bước 2).
 */
export type EmbeddedApp = 'zalo' | 'messenger' | 'facebook' | 'instagram' | 'line' | 'tiktok' | 'android-webview';
export type Platform = 'ios' | 'android' | 'other';

export interface BrowserInfo {
  embedded: EmbeddedApp | null;
  platform: Platform;
}

const RULES: Array<[EmbeddedApp, RegExp]> = [
  ['zalo', /\bZalo\b/i],
  ['messenger', /\bMessenger\b|FBAN\/Messenger|FB_IAB\/MESSENGER/i],
  ['instagram', /\bInstagram\b/i],
  ['facebook', /FBAN|FBAV|FB_IAB|FBIOS/i],
  ['line', /\bLine\/\d/i],
  ['tiktok', /musical_ly|BytedanceWebview|TikTok/i],
  ['android-webview', /; wv\)/],
];

export function detectBrowser(ua: string): BrowserInfo {
  const platform: Platform = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';
  const hit = RULES.find(([, re]) => re.test(ua));
  return { embedded: hit ? hit[0] : null, platform };
}

/** Android: intent mở cùng URL bằng Chrome. Một số WebView chặn intent; khi đó người dùng dùng nút sao chép. */
export function androidChromeIntent(url: string): string {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

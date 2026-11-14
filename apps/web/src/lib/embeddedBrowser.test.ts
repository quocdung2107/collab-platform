import { describe, expect, it } from 'vitest';
import { androidChromeIntent, detectBrowser } from './embeddedBrowser';

// Chuỗi UA mẫu; cần bổ sung UA thu thập từ thiết bị thật ở thử nghiệm OD-18.
const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iosZalo:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/24.10.1 ZaloTheme/light ZaloLanguage/vi',
  androidZalo:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Zalo android/12345 ZaloTheme/light',
  iosMessenger:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/vi_VN;FBOP/5]',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('detectBrowser', () => {
  it.each([
    ['iosSafari', null, 'ios'],
    ['androidChrome', null, 'android'],
    ['desktopChrome', null, 'other'],
    ['iosZalo', 'zalo', 'ios'],
    ['androidZalo', 'zalo', 'android'],
    ['iosMessenger', 'messenger', 'ios'],
    ['androidFacebook', 'facebook', 'android'],
  ] as const)('%s', (key, embedded, platform) => {
    expect(detectBrowser(UA[key])).toEqual({ embedded, platform });
  });
});

describe('androidChromeIntent', () => {
  it('giữ đường dẫn và query', () => {
    const i = androidChromeIntent('https://app.example.org/invite/abc?x=1');
    expect(i.startsWith('intent://app.example.org/invite/abc?x=1#Intent;scheme=https;package=com.android.chrome;')).toBe(true);
  });
});

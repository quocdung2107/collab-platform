import { useState } from 'react';
import { androidChromeIntent, type BrowserInfo } from '../lib/embeddedBrowser';

const APP_NAMES: Record<NonNullable<BrowserInfo['embedded']>, string> = {
  zalo: 'Zalo',
  messenger: 'Messenger',
  facebook: 'Facebook',
  instagram: 'Instagram',
  line: 'LINE',
  tiktok: 'TikTok',
  'android-webview': 'ứng dụng này',
};

/** OD-18 phương án (a): hướng dẫn mở bằng trình duyệt hệ thống trước khi đăng nhập Google. */
export function OpenInBrowser({ info }: { info: BrowserInfo }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  const app = info.embedded ? APP_NAMES[info.embedded] : 'ứng dụng này';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Sao chép đường dẫn này:', url);
    }
  };

  return (
    <section className="card">
      <h1>Mở bằng trình duyệt để đăng nhập</h1>
      <p>
        Google không cho đăng nhập bên trong {app}. Hãy mở trang này bằng{' '}
        {info.platform === 'ios' ? 'Safari' : 'Chrome'} để tiếp tục.
      </p>
      {info.platform === 'android' && (
        <a className="button primary" href={androidChromeIntent(url)}>
          Mở bằng Chrome
        </a>
      )}
      {info.platform === 'ios' && (
        <p className="hint">Chạm vào biểu tượng ••• hoặc ⋯ ở góc màn hình, rồi chọn “Mở bằng Safari” / “Mở trong trình duyệt”.</p>
      )}
      <button className="button" onClick={copy}>
        {copied ? 'Đã sao chép đường dẫn' : 'Sao chép đường dẫn'}
      </button>
    </section>
  );
}

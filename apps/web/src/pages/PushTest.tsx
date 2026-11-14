import { useState } from 'react';
import { enablePush, isIos, isStandalone, pushConfigured, pushSupported, sendTest } from '../lib/push';

/** Trang thử nghiệm OD-17, mở bằng #od17. */
export function PushTest() {
  const [status, setStatus] = useState<string[]>([]);
  const log = (m: string) => setStatus((s) => [`${new Date().toLocaleTimeString('vi-VN')} ${m}`, ...s]);
  const ios = isIos();
  const standalone = isStandalone();

  const run = async (fn: () => Promise<unknown>, label: string) => {
    try {
      const r = await fn();
      log(`${label}: ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    } catch (e) {
      log(`${label} lỗi: ${(e as Error).message}`);
    }
  };

  return (
    <section className="card">
      <h1>Thử thông báo đẩy (OD-17)</h1>
      {!pushConfigured && <p className="error">Bản build thiếu VITE_PUSH_SPIKE_URL / VITE_VAPID_PUBLIC_KEY.</p>}
      <p className="hint">
        Thiết bị: {ios ? 'iPhone/iPad' : 'khác'} · Chạy như ứng dụng đã cài: {standalone ? 'có' : 'không'} · Trình duyệt hỗ trợ
        push: {pushSupported() ? 'có' : 'không'}
      </p>
      {ios && !standalone && (
        <p>
          Trên iPhone, thông báo chỉ hoạt động sau khi <b>thêm vào Màn hình chính</b>: chạm nút Chia sẻ → “Thêm vào MH chính”, rồi mở
          ứng dụng từ biểu tượng mới và quay lại trang này.
        </p>
      )}
      <button className="button primary" disabled={!pushSupported() || !pushConfigured} onClick={() => run(enablePush, 'Bật thông báo')}>
        1. Bật thông báo
      </button>
      <button className="button" onClick={() => run(() => sendTest(3), 'Gửi ngay')}>
        2. Gửi thử (ứng dụng đang mở)
      </button>
      <button className="button" onClick={() => run(() => sendTest(30), 'Gửi sau 30 giây')}>
        3. Gửi sau 30 giây (khoá máy hoặc thoát ứng dụng ngay)
      </button>
      <ul className="hint">
        {status.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

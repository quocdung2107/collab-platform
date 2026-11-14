import { useEffect, useState } from 'react';
import { enablePush, isIos, isStandalone, pushConfigured, pushSupported, sendTest, serviceWorkerState } from '../lib/push';

/** Trang thử nghiệm OD-17, mở bằng #od17. */
export function PushTest() {
  const [status, setStatus] = useState<string[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sw, setSw] = useState('đang kiểm tra…');
  const log = (m: string) => setStatus((s) => [`${new Date().toLocaleTimeString('vi-VN')} ${m}`, ...s]);
  const ios = isIos();
  const standalone = isStandalone();
  const supported = pushSupported();
  const permission = 'Notification' in window ? Notification.permission : 'không hỗ trợ';

  useEffect(() => {
    void serviceWorkerState().then(setSw, (e: unknown) => setSw(`lỗi: ${(e as Error).message}`));
  }, [busy]);

  const run = async (fn: () => Promise<unknown>, label: string, onOk?: () => void) => {
    setBusy(true);
    log(`${label}: bắt đầu`);
    try {
      const r = await fn();
      log(`${label}: xong — ${typeof r === 'string' ? r : JSON.stringify(r)}`);
      onOk?.();
    } catch (e) {
      log(`${label} lỗi: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const blocker = !pushConfigured
    ? 'Bản build thiếu cấu hình push.'
    : ios && !standalone
      ? 'Đang mở trong Safari. Trên iPhone phải mở từ biểu tượng trên Màn hình chính thì mới bật thông báo được.'
      : !supported
        ? 'Trình duyệt này không hỗ trợ thông báo đẩy (iOS cần 16.4 trở lên và mở từ Màn hình chính).'
        : null;

  return (
    <section className="card">
      <h1>Thử thông báo đẩy (OD-17)</h1>
      <ul className="hint">
        <li>Thiết bị: {ios ? 'iPhone/iPad' : 'khác'}</li>
        <li>Mở từ Màn hình chính: {standalone ? 'có' : 'không'}</li>
        <li>Hỗ trợ push: {supported ? 'có' : 'không'}</li>
        <li>Quyền thông báo: {permission}</li>
        <li>Service worker: {sw}</li>
      </ul>
      {blocker && <p className="error">{blocker}</p>}
      {ios && !standalone && (
        <p>
          Cách làm: trong Safari chạm nút Chia sẻ → “Thêm vào MH chính”. Mở ứng dụng từ biểu tượng mới, rồi chạm liên kết
          “Thử thông báo đẩy (OD-17)” ở cuối màn hình đầu tiên.
        </p>
      )}
      <button className="button primary" disabled={!!blocker || busy} onClick={() => run(() => enablePush(log), 'Bật thông báo', () => setSubscribed(true))}>
        1. Bật thông báo
      </button>
      <button className="button" disabled={!subscribed || busy} onClick={() => run(() => sendTest(3), 'Gửi ngay')}>
        2. Gửi thử (ứng dụng đang mở)
      </button>
      <button className="button" disabled={!subscribed || busy} onClick={() => run(() => sendTest(30), 'Gửi sau 30 giây')}>
        3. Gửi sau 30 giây (khoá máy hoặc thoát ứng dụng ngay)
      </button>
      {!subscribed && <p className="hint">Nút 2 và 3 mở sau khi bước 1 thành công.</p>}
      <ul className="hint">
        {status.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

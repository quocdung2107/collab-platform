import { useEffect, useState } from 'react';
import { api, type NotificationPrefs } from '../lib/api';
import { useAction, useLoad } from '../lib/useLoad';
import { pushState, turnOffPush, turnOnPush, type PushState } from '../lib/webpush';

/** Cài đặt thông báo (F11b, NOTIFICATION_ENGINE §7): thiết bị này + công tắc đẩy + giờ yên lặng. */
export function Settings() {
  return (
    <>
      <DevicePush />
      <Preferences />
    </>
  );
}

function DevicePush() {
  const [state, setState] = useState<PushState | null>(null);
  const act = useAction();
  const reload = () => void pushState().then(setState, (e) => setState({ kind: 'unsupported', reason: String((e as Error).message ?? e) }));
  useEffect(reload, []);

  return (
    <section className="card">
      <h2>Thông báo đẩy trên máy này</h2>
      {!state && <p className="hint">Đang kiểm tra…</p>}
      {state?.kind === 'needs_install' && (
        <p>
          Trên iPhone/iPad, thông báo đẩy chỉ chạy khi ứng dụng ở Màn hình chính: chạm <b>Chia sẻ</b> → <b>Thêm vào MH chính</b>, rồi mở Collab từ biểu tượng đó và bật ở đây.
        </p>
      )}
      {state?.kind === 'unsupported' && <p className="hint">{state.reason}</p>}
      {state?.kind === 'server_disabled' && <p className="hint">Máy chủ chưa bật thông báo đẩy. Mọi thông báo vẫn có trong mục Thông báo.</p>}
      {state?.kind === 'denied' && <p>Bạn đã chặn thông báo cho ứng dụng. Mở Cài đặt của máy/trình duyệt → Thông báo → cho phép Collab.</p>}
      {state?.kind === 'off' && (
        <button className="button" disabled={act.busy} onClick={() => act.run(turnOnPush, reload)}>
          Bật thông báo trên máy này
        </button>
      )}
      {state?.kind === 'on' && (
        <div className="row">
          <span>Đang bật ✓</span>
          <button className="button small" disabled={act.busy} onClick={() => act.run(turnOffPush, reload)}>
            Tắt trên máy này
          </button>
        </div>
      )}
      {act.error && <p className="error">{act.error}</p>}
      <p className="hint">Đẩy là kênh phụ: việc "Cần bạn" luôn nằm trong mục Thông báo và Việc của tôi dù bạn tắt đẩy.</p>
    </section>
  );
}

function Preferences() {
  const prefs = useLoad(() => api.notificationPrefs(), []);
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  const act = useAction();
  useEffect(() => setDraft(prefs.data), [prefs.data]);
  if (!draft) return <section className="card">{prefs.error ? <p className="error">{prefs.error}</p> : 'Đang tải…'}</section>;
  const set = (p: Partial<NotificationPrefs>) => setDraft({ ...draft, ...p });
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs.data);

  return (
    <section className="card">
      <h2>Khi nào đẩy thông báo</h2>
      <label className="row">
        <input type="checkbox" checked={draft.pushActionRequired} onChange={(e) => set({ pushActionRequired: e.target.checked })} /> Việc cần bạn trả lời
      </label>
      <label className="row">
        <input type="checkbox" checked={draft.pushDirect} onChange={(e) => set({ pushDirect: e.target.checked })} /> Cập nhật liên quan tới bạn và tin nhắn
      </label>
      <label className="row">
        <input type="checkbox" checked={draft.quietHoursEnabled} onChange={(e) => set({ quietHoursEnabled: e.target.checked })} /> Giờ yên lặng
      </label>
      {draft.quietHoursEnabled && (
        <div className="row">
          từ <input type="time" value={draft.quietStart} onChange={(e) => set({ quietStart: e.target.value })} /> đến{' '}
          <input type="time" value={draft.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} />
        </div>
      )}
      <p className="hint">Trong giờ yên lặng không đẩy gì; hết giờ bạn nhận một thông báo tóm tắt. Ngoại lệ: việc cần bạn cho buổi bắt đầu sớm (trong vòng 2 giờ sau khi hết giờ yên lặng).</p>
      <button className="button" disabled={!dirty || act.busy} onClick={() => act.run(() => api.saveNotificationPrefs(draft), (r) => (setDraft(r), prefs.reload()))}>
        Lưu
      </button>
      {act.error && <p className="error">{act.error}</p>}
    </section>
  );
}

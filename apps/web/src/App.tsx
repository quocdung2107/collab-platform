import type { MeResponse } from '@collab/shared';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './lib/api';
import { detectBrowser } from './lib/embeddedBrowser';
import { signInWithGoogle, signOut, supabase, supabaseConfigured } from './lib/supabase';
import { OpenInBrowser } from './pages/OpenInBrowser';
import { PushTest } from './pages/PushTest';

export function App() {
  const browser = useMemo(() => detectBrowser(navigator.userAgent), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setMe(null);
    api
      .me()
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof ApiError ? `${e.body.code}: ${e.message}` : String(e)));
  }, [session]);

  if (window.location.hash === '#od17') {
    return (
      <main>
        <PushTest />
      </main>
    );
  }

  // Ứng dụng mở từ Màn hình chính không có thanh địa chỉ → cần liên kết tới trang thử OD-17 (bỏ khi xong thử nghiệm).
  const od17Link = (
    <a className="hint" href="#od17" onClick={() => setTimeout(() => window.location.reload(), 0)}>
      Thử thông báo đẩy (OD-17)
    </a>
  );

  if (!supabaseConfigured) {
    return (
      <main>
        <section className="card">
          <h1>Chưa cấu hình</h1>
          <p>Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Xem apps/web/.env.example và docs/SETUP.md.</p>
        </section>
      </main>
    );
  }
  if (session === undefined) return <main className="center">Đang tải…</main>;

  if (!session) {
    return (
      <main>
        {browser.embedded ? (
          <OpenInBrowser info={browser} />
        ) : (
          <section className="card">
            <h1>Collab</h1>
            <p>Lịch phục vụ, việc cần làm và trò chuyện của hội thánh ở một nơi.</p>
            <button className="button primary" onClick={() => signInWithGoogle()}>
              Đăng nhập bằng Google
            </button>
          </section>
        )}
        {od17Link}
      </main>
    );
  }

  return (
    <main>
      <section className="card">
        {error && <p className="error">{error}</p>}
        {me ? (
          <>
            <h1>Xin chào, {me.user.displayName}</h1>
            {me.memberships.length === 0 ? (
              <p>Bạn chưa thuộc tổ chức nào. Hãy mở liên kết mời do người quản lý gửi.</p>
            ) : (
              <ul>
                {me.memberships.map((m) => (
                  <li key={m.orgId}>
                    {m.orgName} — {m.role}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          !error && <p>Đang tải hồ sơ…</p>
        )}
        <button className="button" onClick={() => signOut()}>
          Đăng xuất
        </button>
      </section>
      {od17Link}
    </main>
  );
}

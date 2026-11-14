import type { MeResponse } from '@collab/shared';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from './lib/api';
import { detectBrowser } from './lib/embeddedBrowser';
import { go, pendingInvite, useRoute } from './lib/route';
import { signInWithGoogle, signOut, supabase, supabaseConfigured } from './lib/supabase';
import { GroupPage } from './pages/GroupPage';
import { Home } from './pages/Home';
import { InvitePage } from './pages/InvitePage';
import { OpenInBrowser } from './pages/OpenInBrowser';
import { OrgPage } from './pages/OrgPage';
import { PushTest } from './pages/PushTest';

export function App() {
  const browser = useMemo(() => detectBrowser(navigator.userAgent), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meTick, setMeTick] = useState(0);
  const route = useRoute();
  const reloadMe = () => setMeTick((t) => t + 1);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setMe(null);
    api
      .me()
      .then((m) => (setMe(m), setError(null)))
      .catch((e: unknown) => setError(errorText(e)));
  }, [session, meTick]);

  // Mở lại liên kết mời đã giữ trước vòng đăng nhập OAuth.
  useEffect(() => {
    if (!session) return;
    const token = pendingInvite.take();
    if (token && route.name === 'home') go({ name: 'invite', token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (route.name === 'od17') {
    return (
      <main>
        <PushTest />
      </main>
    );
  }

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
            {route.name === 'invite' && <p>Bạn được mời tham gia. Đăng nhập để tiếp tục.</p>}
            <button
              className="button primary"
              onClick={() => {
                if (route.name === 'invite') pendingInvite.save(route.token);
                void signInWithGoogle();
              }}
            >
              Đăng nhập bằng Google
            </button>
          </section>
        )}
      </main>
    );
  }

  if (error && !me) {
    return (
      <main>
        <section className="card">
          <p className="error">{error}</p>
          <button className="button" onClick={reloadMe}>
            Thử lại
          </button>
          <button className="button" onClick={() => signOut()}>
            Đăng xuất
          </button>
        </section>
      </main>
    );
  }
  if (!me) return <main className="center">Đang tải hồ sơ…</main>;

  return (
    <main>
      {route.name === 'invite' && <InvitePage token={route.token} onJoined={reloadMe} />}
      {route.name === 'org' && <OrgPage key={route.id} orgId={route.id} meId={me.user.id} onMembershipChanged={reloadMe} />}
      {route.name === 'group' && <GroupPage key={route.id} groupId={route.id} meId={me.user.id} />}
      {route.name === 'home' && <Home me={me} onChanged={reloadMe} />}
      <button className="button small" onClick={() => signOut()}>
        Đăng xuất
      </button>
    </main>
  );
}

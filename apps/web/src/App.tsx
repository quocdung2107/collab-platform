import type { MeResponse } from '@collab/shared';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from './lib/api';
import { detectBrowser } from './lib/embeddedBrowser';
import { useRealtime } from './lib/realtime';
import { go, href, pendingInvite, useRoute } from './lib/route';
import { useLoad } from './lib/useLoad';
import { signInWithGoogle, signOut, supabase, supabaseConfigured } from './lib/supabase';
import { TaskPage } from './pages/Tasks';
import { EventPage } from './pages/EventPage';
import { GroupPage } from './pages/GroupPage';
import { Home } from './pages/Home';
import { Inbox } from './pages/Inbox';
import { InvitePage } from './pages/InvitePage';
import { NewEventPage } from './pages/NewEventPage';
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
  const meId = me?.user.id;
  const counts = useLoad(() => (meId ? api.notificationCounts() : Promise.resolve(null)), [meId]);
  useRealtime(meId ? [`user:${meId}`] : [], counts.reload);

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
        {od17Link}
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
        {od17Link}
      </main>
    );
  }
  if (!me) return <main className="center">Đang tải hồ sơ…</main>;

  const pendingCount = counts.data?.pendingCount ?? 0;
  const unreadCount = counts.data?.unreadCount ?? 0;
  return (
    <main>
      <nav className="topbar">
        <a href={href({ name: 'home' })}>Trang chủ</a>
        <a href={href({ name: 'inbox' })} className="row">
          Thông báo
          {pendingCount > 0 && <span className="badge">{pendingCount} cần bạn</span>}
          {pendingCount === 0 && unreadCount > 0 && <span className="badge">{unreadCount}</span>}
        </a>
      </nav>
      {route.name === 'inbox' && <Inbox meId={me.user.id} onCounts={counts.reload} />}
      {route.name === 'invite' && <InvitePage token={route.token} onJoined={reloadMe} />}
      {route.name === 'org' && <OrgPage key={route.id} orgId={route.id} meId={me.user.id} onMembershipChanged={reloadMe} />}
      {route.name === 'group' && <GroupPage key={route.id} groupId={route.id} meId={me.user.id} />}
      {route.name === 'event' && <EventPage key={route.id} eventId={route.id} meId={me.user.id} />}
      {route.name === 'task' && <TaskPage key={route.id} taskId={route.id} meId={me.user.id} />}
      {route.name === 'newevent' && <NewEventPage key={route.id + (route.copy ?? '')} orgId={route.id} copyFrom={route.copy} />}
      {route.name === 'home' && <Home me={me} onChanged={reloadMe} />}
      <button className="button small" onClick={() => signOut()}>
        Đăng xuất
      </button>
      {od17Link}
    </main>
  );
}

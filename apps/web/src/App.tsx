import type { MeResponse } from '@collab/shared';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from './lib/api';
import { detectBrowser } from './lib/embeddedBrowser';
import { useRealtime } from './lib/realtime';
import { setCurrentOrg, useCurrentOrg } from './lib/currentOrg';
import { go, href, isTabRoot, pendingInvite, tabOf, useRoute, type Route } from './lib/route';
import { useLoad } from './lib/useLoad';
import { signInWithGoogle, signOut, supabase, supabaseConfigured } from './lib/supabase';
import { CalendarTab } from './pages/Calendar';
import { Planner } from './pages/Planner';
import { Chats } from './pages/Chats';
import { Groups } from './pages/Groups';
import { ChatScreen } from './pages/ChatScreen';
import { Me } from './pages/Me';
import { TaskPage } from './pages/Tasks';
import { EventPage } from './pages/EventPage';
import { GroupPage } from './pages/GroupPage';
import { Home } from './pages/Home';
import { Inbox } from './pages/Inbox';
import { InvitePage } from './pages/InvitePage';
import { NewEventPage } from './pages/NewEventPage';
import { OpenInBrowser } from './pages/OpenInBrowser';
import { OrgPage } from './pages/OrgPage';
import { Settings } from './pages/Settings';
import { DialogHost } from './ui/dialogs';
import { Icon } from './ui/icons';
import { useScrollRestore } from './ui/scroll';
import { useScreenTitle } from './ui/title';
import { initialsOf, LargeHeader, NavHeader, TabBar, TopActions } from './ui/Shell';

export function App() {
  const browser = useMemo(() => detectBrowser(navigator.userAgent), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meTick, setMeTick] = useState(0);
  const route = useRoute();
  const reloadMe = () => setMeTick((t) => t + 1);
  const meId = me?.user.id;
  const org = useCurrentOrg(me?.memberships ?? []);
  const screenTitle = useScreenTitle();
  useScrollRestore(href(route));
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

  if (!supabaseConfigured) {
    return (
      <main className="solo">
        <section className="card">
          <h1>Chưa cấu hình</h1>
          <p>Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Xem apps/web/.env.example và docs/SETUP.md.</p>
        </section>
      </main>
    );
  }
  if (session === undefined) return <main className="solo center">Đang tải…</main>;

  if (!session) {
    return (
      <main className="solo">
        {browser.embedded ? (
          <OpenInBrowser info={browser} />
        ) : (
          <section className="card welcome">
            <img className="brand" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} />
            <h1>Collab</h1>
            <p className="hint">Lịch phục vụ, việc cần làm và trò chuyện của hội thánh ở một nơi.</p>
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
      <main className="solo">
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
  if (!me) return <main className="solo center">Đang tải hồ sơ…</main>;

  const pendingCount = counts.data?.pendingCount ?? 0;
  const unreadCount = counts.data?.unreadCount ?? 0;
  const isAdmin = org?.role === 'owner' || org?.role === 'admin';
  const actions = <TopActions unread={unreadCount} pending={pendingCount} initials={initialsOf(me.user.displayName)} />;
  const needsOrg = route.name === 'calendar' || route.name === 'plan' || route.name === 'chats' || route.name === 'groups';
  const picker =
    needsOrg && org ? (
      me.memberships.length > 1 ? (
        <label className="org-picker">
          <span className="sr-only">Tổ chức đang xem</span>
          <select value={org.orgId} onChange={(e) => setCurrentOrg(e.target.value)}>
            {me.memberships.map((m) => (
              <option key={m.orgId} value={m.orgId}>
                {m.orgName}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={16} />
        </label>
      ) : (
        <span className="org-picker">{org.orgName}</span>
      )
    ) : null;

  return (
    <div className="app">
      {isTabRoot(route) ? (
        <LargeHeader title={TITLE[route.name]} leading={picker} actions={actions} />
      ) : (
        <NavHeader route={route} title={screenTitle ?? { title: TITLE[route.name] }} actions={route.name === 'chat' ? null : actions} />
      )}
      <main className={route.name === 'chat' ? 'content chat-content' : route.name === 'plan' ? 'content wide' : 'content'} key={href(route)}>
        {needsOrg && !org && (
          <section className="card">
            <p className="hint">Bạn chưa thuộc tổ chức nào.</p>
            <a className="button" href={href({ name: 'home' })}>
              Bắt đầu
            </a>
          </section>
        )}
        {route.name === 'home' && <Home me={me} onChanged={reloadMe} />}
        {route.name === 'calendar' && org && <CalendarTab key={org.orgId} orgId={org.orgId} meId={me.user.id} isAdmin={isAdmin} />}
        {route.name === 'plan' && org && <Planner key={org.orgId} orgId={org.orgId} meId={me.user.id} />}
        {route.name === 'chats' && org && <Chats key={org.orgId} orgId={org.orgId} meId={me.user.id} />}
        {route.name === 'groups' && org && <Groups key={org.orgId} orgId={org.orgId} meId={me.user.id} isAdmin={isAdmin} />}
        {route.name === 'me' && <Me me={me} currentOrgId={org?.orgId ?? null} onChanged={reloadMe} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'inbox' && <Inbox meId={me.user.id} onCounts={counts.reload} />}
        {route.name === 'invite' && <InvitePage token={route.token} onJoined={reloadMe} />}
        {route.name === 'org' && <OrgPage key={route.id} orgId={route.id} meId={me.user.id} onMembershipChanged={reloadMe} />}
        {route.name === 'group' && <GroupPage key={route.id} groupId={route.id} meId={me.user.id} />}
        {route.name === 'event' && <EventPage key={route.id} eventId={route.id} meId={me.user.id} />}
        {route.name === 'chat' && <ChatScreen key={route.id} conversationId={route.id} meId={me.user.id} />}
        {route.name === 'task' && <TaskPage key={route.id} taskId={route.id} meId={me.user.id} />}
        {route.name === 'newevent' && <NewEventPage key={route.id + (route.copy ?? '')} orgId={route.id} copyFrom={route.copy} />}
      </main>
      <TabBar active={tabOf(route)} badges={{ work: pendingCount }} hiddenOnPhone={route.name === 'chat'} />
      <DialogHost />
    </div>
  );
}

const TITLE: Record<Route['name'], string> = {
  home: 'Việc của tôi',
  calendar: 'Lịch',
  plan: 'Lập lịch',
  chats: 'Chat',
  groups: 'Nhóm',
  me: 'Tài khoản',
  settings: 'Cài đặt thông báo',
  inbox: 'Thông báo',
  invite: 'Lời mời',
  org: 'Tổ chức',
  group: 'Nhóm',
  event: 'Buổi',
  task: 'Việc',
  chat: 'Trò chuyện',
  newevent: 'Tạo buổi',
};

-- S12 · F11b: kênh đẩy Web Push (NOTIFICATION_ENGINE §7, §8.3, §8.6, §9; DATA_MODEL §3 + §7 "device_tokens → push_subscriptions").
-- Bản ghi trong hộp thông báo là nguồn sự thật; bảng ở đây chỉ phục vụ kênh đẩy (nỗ lực tốt nhất).

create table app.push_subscriptions (
  id                   uuid primary key default app.uuid_v7(),
  user_id              uuid not null references app.users (id),
  endpoint             text not null unique,
  p256dh               text not null,
  auth                 text not null,
  platform             text not null default 'web' check (platform in ('ios', 'android', 'desktop', 'web')),
  installed_standalone boolean not null default false,
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  disabled_at          timestamptz,
  disabled_reason      text check (disabled_reason in ('gone', 'unsubscribed', 'replaced'))
);
create index push_subscriptions_user_idx on app.push_subscriptions (user_id) where disabled_at is null;

-- Áp theo người dùng, chung mọi tổ chức (§7). Không có dòng = mặc định (OD-03: 22:00–06:30, bật).
create table app.notification_preferences (
  user_id              uuid primary key references app.users (id),
  push_action_required boolean not null default true,
  push_direct          boolean not null default true,
  quiet_hours_enabled  boolean not null default true,
  quiet_start          time not null default '22:00',
  quiet_end            time not null default '06:30',
  updated_at           timestamptz not null default now()
);

-- Mỗi thiết bị một delivery cho mỗi bản ghi (kind = notification) hoặc mỗi hội thoại (kind = chat, thu gọn §9).
-- Dòng được dùng lại: bản ghi được gộp/làm mới hoặc hội thoại có tin mới → quay về scheduled.
create table app.notification_deliveries (
  id              uuid primary key default app.uuid_v7(),
  user_id         uuid not null references app.users (id),
  subscription_id uuid not null references app.push_subscriptions (id),
  kind            text not null check (kind in ('notification', 'chat')),
  notification_id uuid references app.notifications (id) on delete cascade,
  conversation_id uuid references app.conversations (id),
  last_seq        bigint,
  channel         text not null default 'push' check (channel = 'push'),
  status          text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'cancelled', 'skipped')),
  not_before      timestamptz not null,
  quiet_deferred  boolean not null default false,
  attempts        int not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'notification') = (notification_id is not null)),
  check ((kind = 'chat') = (conversation_id is not null and last_seq is not null))
);
create unique index notification_deliveries_notification_uq on app.notification_deliveries (notification_id, subscription_id) where kind = 'notification';
create unique index notification_deliveries_chat_uq on app.notification_deliveries (conversation_id, subscription_id) where kind = 'chat';
create index notification_deliveries_due_idx on app.notification_deliveries (not_before) where status = 'scheduled';
create index notification_deliveries_sub_idx on app.notification_deliveries (subscription_id) where status = 'scheduled';

alter table app.push_subscriptions       enable row level security;
alter table app.notification_preferences enable row level security;
alter table app.notification_deliveries  enable row level security;

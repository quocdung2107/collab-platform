-- 0005_notifications: hộp thông báo, Subscription (DATA_MODEL §3.6–3.7, NOTIFICATION_ENGINE). Lát S6.
-- Kênh đẩy (notification_deliveries, push_subscriptions, notification_preferences) thêm ở S12.

create table app.subscriptions (
  user_id     uuid not null references app.users (id),
  org_id      uuid not null references app.organizations (id),
  target_type text not null check (target_type in ('event', 'task', 'conversation')),
  target_id   uuid not null,
  mode        text not null,
  created_by  uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id),
  check ((target_type in ('event', 'task') and mode in ('follow', 'mute'))
      or (target_type = 'conversation' and mode in ('all', 'mentions', 'mute')))
);
create index subscriptions_target_idx on app.subscriptions (target_type, target_id, mode);

create table app.notifications (
  id                 uuid primary key default app.uuid_v7(),
  org_id             uuid not null references app.organizations (id),
  user_id            uuid not null references app.users (id),
  root_activity_id   uuid not null references app.activity_events (id) on delete cascade,
  class              text not null check (class in ('action_required', 'direct')),
  family             text,
  object_type        text not null,
  object_id          uuid not null,
  reasons            text[] not null,
  action_state       text not null check (action_state in ('none', 'pending', 'done', 'superseded')),
  read_at            timestamptz,
  action_resolved_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, root_activity_id),
  check ((class = 'direct') = (action_state = 'none'))
);
create index notifications_user_created_idx on app.notifications (user_id, created_at desc);
create index notifications_user_unread_idx  on app.notifications (user_id) where read_at is null;
create index notifications_user_pending_idx on app.notifications (user_id) where action_state = 'pending';
create index notifications_object_idx       on app.notifications (object_type, object_id);

create table app.notification_items (
  notification_id   uuid not null references app.notifications (id) on delete cascade,
  activity_event_id uuid not null references app.activity_events (id) on delete cascade,
  verb              text not null,
  object_type       text not null,
  object_id         uuid not null,
  needs_action      boolean not null default false,
  resolved_at       timestamptz,
  -- Thêm so với DATA_MODEL: phân biệt done/superseded khi mọi mục cần hành động đã xong (IN-21).
  resolution        text check (resolution in ('done', 'superseded')),
  primary key (notification_id, activity_event_id),
  check ((resolved_at is null) = (resolution is null))
);
create index notification_items_open_idx on app.notification_items (object_type, object_id) where needs_action and resolved_at is null;

alter table app.subscriptions      enable row level security;
alter table app.notifications      enable row level security;
alter table app.notification_items enable row level security;

-- Sự kiện ghi trước khi có notifier không sinh thông báo hồi tố (dữ liệu thử nghiệm cũ).
update app.activity_events set dispatched_at = now() where dispatched_at is null;

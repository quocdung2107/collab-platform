-- 0003_messaging: hội thoại và tin nhắn (DATA_MODEL §3.5, F9). Lát S4: hội thoại anchor = group.
-- anchor event/task dùng cùng bảng ở các lát sau.

create table app.conversations (
  id              uuid primary key default app.uuid_v7(),
  org_id          uuid not null references app.organizations (id),
  anchor_type     text not null check (anchor_type in ('group', 'event', 'task')),
  anchor_id       uuid not null,
  last_seq        bigint not null default 0,
  last_message_at timestamptz,
  read_only       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (anchor_type, anchor_id)
);
create index conversations_org_last_idx on app.conversations (org_id, last_message_at);

create table app.messages (
  id                uuid primary key default app.uuid_v7(),
  org_id            uuid not null references app.organizations (id),
  conversation_id   uuid not null references app.conversations (id),
  seq               bigint not null,
  kind              text not null check (kind in ('user', 'system')),
  sender_id         uuid references app.users (id),
  body              text,
  body_norm         text,
  reply_to_id       uuid references app.messages (id),
  activity_event_id uuid references app.activity_events (id),
  client_msg_id     text check (length(client_msg_id) between 8 and 100),
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,
  deleted_by        uuid references app.users (id),
  unique (conversation_id, seq),
  check ((kind = 'user') = (sender_id is not null)),
  check (kind = 'user' or activity_event_id is not null),
  check (deleted_at is null or (body is null and body_norm is null))
);
create unique index messages_client_msg_uq on app.messages (conversation_id, sender_id, client_msg_id) where client_msg_id is not null;
create unique index messages_activity_uq   on app.messages (conversation_id, activity_event_id) where activity_event_id is not null;

create table app.message_mentions (
  message_id      uuid not null references app.messages (id),
  user_id         uuid not null references app.users (id),
  org_id          uuid not null references app.organizations (id),
  conversation_id uuid not null references app.conversations (id),
  primary key (message_id, user_id)
);
create index message_mentions_user_idx on app.message_mentions (user_id, message_id);

create table app.conversation_states (
  conversation_id uuid not null references app.conversations (id),
  user_id         uuid not null references app.users (id),
  last_read_seq   bigint not null default 0,
  last_pushed_seq bigint not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_states_user_idx on app.conversation_states (user_id, updated_at);

-- Nhóm có từ trước lát này: mỗi nhóm một hội thoại; nhóm đã lưu trữ → chỉ-đọc.
insert into app.conversations (org_id, anchor_type, anchor_id, read_only)
select org_id, 'group', id, archived_at is not null from app.groups;

alter table app.conversations       enable row level security;
alter table app.messages            enable row level security;
alter table app.message_mentions    enable row level security;
alter table app.conversation_states enable row level security;

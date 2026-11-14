-- 0001_identity: lõi danh tính, tổ chức, nhóm và nhật ký sự kiện (DATA_MODEL §3.1, §3.2, §3.6).
-- PostgreSQL chuẩn, không phụ thuộc Supabase (AD-29). Đối tượng đặc thù Supabase nằm ở db/supabase/.

create schema if not exists app;

-- UUID v7 (sắp xếp theo thời gian). PostgreSQL < 18 chưa có uuidv7() sẵn.
create or replace function app.uuid_v7() returns uuid
language plpgsql volatile as $$
declare
  ts bytea := substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  b  bytea := uuid_send(gen_random_uuid());
begin
  b := overlay(b placing ts from 1 for 6);
  b := set_byte(b, 6, (b'0111' || get_byte(b, 6)::bit(4))::bit(8)::int);
  b := set_byte(b, 8, (b'10' || get_byte(b, 8)::bit(6))::bit(8)::int);
  return encode(b, 'hex')::uuid;
end $$;

-- users ---------------------------------------------------------------------
create table app.users (
  id                 uuid primary key default app.uuid_v7(),
  display_name       text not null,
  auth_subject       text not null unique,          -- AD-26: khoá ngoài-logic, không FK tới auth.users
  phone              text,
  email              text,
  contact_visibility text not null default 'managers'
                     check (contact_visibility in ('org', 'managers', 'hidden')),
  timezone           text,
  locale             text not null default 'vi',
  created_at         timestamptz not null default now(),
  anonymized_at      timestamptz
);
create unique index users_phone_uq on app.users (phone) where phone is not null;
create unique index users_email_uq on app.users (email) where email is not null;

-- organizations -------------------------------------------------------------
create table app.organizations (
  id                       uuid primary key default app.uuid_v7(),
  name                     text not null check (length(btrim(name)) > 0),
  timezone                 text not null default 'Asia/Ho_Chi_Minh',
  default_event_visibility text not null default 'org'
                           check (default_event_visibility in ('org', 'groups')),
  reconfirm_threshold_min  int  not null default 30 check (reconfirm_threshold_min >= 0),
  created_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  version                  int  not null default 1
);

-- memberships ---------------------------------------------------------------
create table app.memberships (
  org_id     uuid not null references app.organizations (id),
  user_id    uuid not null references app.users (id),
  role       text not null check (role in ('owner', 'admin', 'member')),
  status     text not null default 'active' check (status in ('active', 'removed')),
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references app.users (id),
  primary key (org_id, user_id),
  check ((status = 'removed') = (removed_at is not null))
);
create index memberships_user_status_idx on app.memberships (user_id, status);
-- "Luôn còn ít nhất một owner active" được bảo đảm ở tầng ứng dụng, trong giao dịch có khoá dòng.

-- groups --------------------------------------------------------------------
create table app.groups (
  id          uuid primary key default app.uuid_v7(),
  org_id      uuid not null references app.organizations (id),
  name        text not null check (length(btrim(name)) > 0),
  description text,
  name_norm   text not null,
  created_by  uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  version     int  not null default 1
);
create unique index groups_org_name_active_uq on app.groups (org_id, name) where archived_at is null;
create index groups_org_idx on app.groups (org_id);

create table app.group_members (
  group_id uuid not null references app.groups (id),
  user_id  uuid not null references app.users (id),
  org_id   uuid not null references app.organizations (id),
  role     text not null check (role in ('leader', 'member')),
  added_by uuid not null references app.users (id),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on app.group_members (user_id);

-- invites -------------------------------------------------------------------
create table app.invites (
  id         uuid primary key default app.uuid_v7(),
  org_id     uuid not null references app.organizations (id),
  token_hash text not null unique,                   -- không lưu token gốc (T13)
  role       text not null check (role in ('admin', 'member')),
  group_id   uuid references app.groups (id),
  max_uses   int check (max_uses is null or max_uses > 0),
  used_count int not null default 0 check (used_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  check (max_uses is null or used_count <= max_uses)
);
create index invites_org_idx on app.invites (org_id);

-- activity_events (append-only, outbox; AD-08) ------------------------------
create table app.activity_events (
  id              uuid primary key default app.uuid_v7(),
  seq             bigint generated always as identity unique,
  org_id          uuid not null references app.organizations (id),
  verb            text not null,
  actor_type      text not null check (actor_type in ('user', 'system')),
  actor_id        uuid references app.users (id),
  object_type     text not null,
  object_id       uuid not null,
  event_id        uuid,
  task_id         uuid,
  group_id        uuid,
  conversation_id uuid,
  cause_id        uuid references app.activity_events (id),
  payload         jsonb not null default '{}'::jsonb,
  request_id      text,
  occurred_at     timestamptz not null default now(),
  dispatched_at   timestamptz,
  check ((actor_type = 'user') = (actor_id is not null))
);
create index activity_object_idx    on app.activity_events (object_type, object_id, occurred_at);
create index activity_event_idx     on app.activity_events (event_id, occurred_at) where event_id is not null;
create index activity_task_idx      on app.activity_events (task_id, occurred_at)  where task_id is not null;
create index activity_group_idx     on app.activity_events (group_id, occurred_at) where group_id is not null;
create index activity_cause_idx     on app.activity_events (cause_id);
create index activity_undispatched  on app.activity_events (seq) where dispatched_at is null;
create index activity_org_actor_idx on app.activity_events (org_id, actor_id, occurred_at);

-- RLS: bật trên mọi bảng nghiệp vụ, mặc định từ chối (PERMISSION_MODEL phụ lục §3).
-- Backend kết nối bằng vai trò chủ sở hữu bảng nên không bị RLS chặn; can() là nguồn sự thật.
alter table app.users           enable row level security;
alter table app.organizations   enable row level security;
alter table app.memberships     enable row level security;
alter table app.groups          enable row level security;
alter table app.group_members   enable row level security;
alter table app.invites         enable row level security;
alter table app.activity_events enable row level security;

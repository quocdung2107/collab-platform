-- 0004_scheduling: Event, Position, Assignment, mẫu buổi (DATA_MODEL §3.3, F3, F4).

create table app.event_templates (
  id          uuid primary key default app.uuid_v7(),
  org_id      uuid not null references app.organizations (id),
  name        text not null check (length(name) between 1 and 120),
  -- {duration_min, group_ids[], positions[{name, group_id?, slots, report_offset_min}], tasks[{title, due_offset_min}]}
  definition  jsonb not null,
  created_by  uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  version     int not null default 1
);
create index event_templates_org_idx on app.event_templates (org_id) where archived_at is null;

create table app.events (
  id            uuid primary key default app.uuid_v7(),
  org_id        uuid not null references app.organizations (id),
  title         text not null check (length(title) between 1 and 200),
  title_norm    text not null,
  description   text,
  location      text,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  visibility    text not null check (visibility in ('org', 'groups')),
  template_id   uuid references app.event_templates (id),
  copied_from   uuid references app.events (id),
  created_by    uuid not null references app.users (id),
  published_at  timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  check (ends_at > starts_at)
);
create index events_org_status_start_idx on app.events (org_id, status, starts_at);

create table app.event_groups (
  event_id uuid not null references app.events (id) on delete cascade,
  group_id uuid not null references app.groups (id),
  org_id   uuid not null references app.organizations (id),
  primary key (event_id, group_id)
);
create index event_groups_group_idx on app.event_groups (group_id, event_id);

create table app.event_owners (
  event_id uuid not null references app.events (id) on delete cascade,
  user_id  uuid not null references app.users (id),
  org_id   uuid not null references app.organizations (id),
  added_by uuid not null references app.users (id),
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_owners_user_idx on app.event_owners (user_id);

create table app.positions (
  id                uuid primary key default app.uuid_v7(),
  org_id            uuid not null references app.organizations (id),
  event_id          uuid not null references app.events (id) on delete cascade,
  name              text not null check (length(name) between 1 and 120),
  group_id          uuid references app.groups (id),
  slots             int not null default 1 check (slots >= 1),
  report_offset_min int not null default 0,
  sort              int not null default 0,
  removed_at        timestamptz,
  version           int not null default 1
);
create index positions_event_idx on app.positions (event_id, sort);

create table app.assignments (
  id                     uuid primary key default app.uuid_v7(),
  org_id                 uuid not null references app.organizations (id),
  event_id               uuid not null references app.events (id) on delete cascade,
  position_id            uuid not null references app.positions (id) on delete cascade,
  user_id                uuid not null references app.users (id),
  status                 text not null check (status in ('draft', 'requested', 'accepted', 'declined', 'reconfirm', 'cancelled')),
  cancel_reason          text check (cancel_reason in ('removed', 'replaced', 'event_cancelled', 'position_removed', 'member_left')),
  decline_reason         text,
  requested_by           uuid references app.users (id),
  requested_at           timestamptz,
  responded_at           timestamptz,
  responded_by           uuid references app.users (id),
  replaces_assignment_id uuid references app.assignments (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status <> 'declined' or decline_reason is not null)
);
create unique index assignments_active_uq on app.assignments (position_id, user_id)
  where status in ('draft', 'requested', 'accepted', 'reconfirm');
create index assignments_user_status_idx     on app.assignments (user_id, status);
create index assignments_event_status_idx    on app.assignments (event_id, status);
create index assignments_position_status_idx on app.assignments (position_id, status);

alter table app.event_templates enable row level security;
alter table app.events          enable row level security;
alter table app.event_groups    enable row level security;
alter table app.event_owners    enable row level security;
alter table app.positions       enable row level security;
alter table app.assignments     enable row level security;

-- 0006_tasks: Task và người tham gia (DATA_MODEL §3.4, F8, PERMISSION_MODEL §4.6).

create table app.tasks (
  id                  uuid primary key default app.uuid_v7(),
  org_id              uuid not null references app.organizations (id),
  scope_type          text not null check (scope_type in ('event', 'group', 'private')),
  event_id            uuid references app.events (id),
  group_id            uuid references app.groups (id),
  title               text not null check (length(title) between 1 and 200),
  title_norm          text not null,
  description         text,
  owner_id            uuid references app.users (id),
  assigned_by         uuid references app.users (id),
  created_by          uuid not null references app.users (id),
  requires_acceptance boolean not null default false,
  acceptance          text not null default 'none' check (acceptance in ('none', 'pending', 'accepted', 'declined')),
  decline_reason      text,
  status              text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  blocked             boolean not null default false,
  needs_help          boolean not null default false,
  due_at              timestamptz,
  due_offset_min      int,
  completed_at        timestamptz,
  completed_by        uuid references app.users (id),
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  check ((scope_type = 'event' and event_id is not null and group_id is null)
      or (scope_type = 'group' and group_id is not null and event_id is null)
      or (scope_type = 'private' and event_id is null and group_id is null)),
  check (due_offset_min is null or scope_type = 'event'),
  check (due_offset_min is null or due_at is not null),
  check ((status = 'done') = (completed_at is not null))
);
create index tasks_owner_status_idx      on app.tasks (owner_id, status);
create index tasks_event_idx             on app.tasks (event_id) where event_id is not null;
create index tasks_group_status_idx      on app.tasks (group_id, status) where group_id is not null;
create index tasks_assigned_by_accept_idx on app.tasks (assigned_by, acceptance);
create index tasks_org_due_idx           on app.tasks (org_id, due_at) where status in ('open', 'in_progress');

create table app.task_collaborators (
  task_id  uuid not null references app.tasks (id),
  user_id  uuid not null references app.users (id),
  org_id   uuid not null references app.organizations (id),
  added_by uuid not null references app.users (id),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_collaborators_user_idx on app.task_collaborators (user_id);

alter table app.tasks              enable row level security;
alter table app.task_collaborators enable row level security;

-- 0007_links: Link giữa tin nhắn và đối tượng công việc (DATA_MODEL §3.6, CONTEXT_ENGINE §2, F10).

create table app.links (
  id         uuid primary key default app.uuid_v7(),
  org_id     uuid not null references app.organizations (id),
  from_type  text not null,
  from_id    uuid not null,
  to_type    text not null,
  to_id      uuid not null,
  relation   text not null check (relation in ('references', 'created_from', 'resolution', 'blocks')),
  origin     text not null check (origin in ('system', 'manual')),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references app.users (id),
  -- Cặp hợp lệ theo CONTEXT_ENGINE §2.2; user không bao giờ là một đầu.
  check (
       (relation = 'references'   and from_type = 'message' and to_type in ('event', 'task', 'group'))
    or (relation = 'references'   and from_type in ('event', 'task') and to_type in ('event', 'task'))
    or (relation = 'created_from' and from_type = 'task' and to_type = 'message')
    or (relation = 'resolution'   and from_type = 'message' and to_type in ('event', 'task', 'group'))
    or (relation = 'blocks'       and from_type = 'task' and to_type = 'task')),
  check (not (from_type = to_type and from_id = to_id))
);
create unique index links_active_uq on app.links (from_type, from_id, to_type, to_id, relation) where deleted_at is null;
create index links_from_idx on app.links (from_type, from_id) where deleted_at is null;
create index links_to_idx   on app.links (to_type, to_id) where deleted_at is null;

alter table app.links enable row level security;

-- 0008_attachments: siêu dữ liệu tệp; nội dung ở Storage (DATA_MODEL §3.5, §8; F9b; F14-T4).

create table app.attachments (
  id          uuid primary key default app.uuid_v7(),
  org_id      uuid not null references app.organizations (id),
  owner_type  text not null check (owner_type in ('message', 'event', 'task')),
  owner_id    uuid not null,
  storage_key text not null unique,
  filename    text not null check (length(filename) between 1 and 255),
  mime        text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  uploaded_by uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references app.users (id)
);
create index attachments_owner_idx on app.attachments (owner_type, owner_id) where removed_at is null;

alter table app.attachments enable row level security;

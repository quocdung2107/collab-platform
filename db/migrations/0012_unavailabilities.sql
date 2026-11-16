-- 0012_unavailabilities: ngày bận của thành viên (AD-34). Chỉ thêm bảng mới, không đổi dữ liệu hiện có.
-- Không có cột lý do (PERMISSION_MODEL T10: lý do vắng là dữ liệu nhạy cảm, bản tối thiểu không lưu).
create table app.unavailabilities (
  id         uuid primary key default app.uuid_v7(),
  org_id     uuid not null references app.organizations (id),
  user_id    uuid not null references app.users (id),
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 365)
);
create index unavailabilities_user_idx on app.unavailabilities (user_id, org_id, ends_on);
alter table app.unavailabilities enable row level security;

-- 0002_idempotency: khoá idempotent cho lệnh ghi (EVENT_API_CONTRACTS §4, AD-13).
-- Lặp lại cùng (user, key) trong 24 giờ trả kết quả lần đầu, không ghi thêm.
create table app.idempotency_keys (
  user_id      uuid not null references app.users (id),
  key          text not null check (length(key) between 8 and 200),
  request_hash text not null,
  status_code  int,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, key)
);
create index idempotency_keys_created_idx on app.idempotency_keys (created_at);
alter table app.idempotency_keys enable row level security;

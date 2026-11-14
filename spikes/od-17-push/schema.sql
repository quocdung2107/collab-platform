-- Bảng tạm cho thử nghiệm OD-17 (schema spike, không thuộc migration của sản phẩm).
create schema if not exists spike;
create table if not exists spike.config (key text primary key, value text not null);
create table if not exists spike.push_subscriptions (
  device_id text primary key, endpoint text not null, p256dh text not null, auth text not null,
  ua text, standalone boolean, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists spike.push_log (
  id uuid primary key default gen_random_uuid(), device_id text not null, delay_sec int,
  created_at timestamptz default now(), sent_at timestamptz, push_status int, push_error text,
  received_at timestamptz, app_state text);

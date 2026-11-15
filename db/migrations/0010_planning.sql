-- 0010_planning: lập lịch nhiều cấp (AD-32). Giai đoạn, Nhịp, Biến thể; Event gắn với Nhịp.
-- Bước P2–P5 trong docs/design/lich-nhieu-cap.md. Chỉ thêm bảng/cột, không đổi dữ liệu cũ.

create table app.plan_periods (
  id          uuid primary key default app.uuid_v7(),
  org_id      uuid not null references app.organizations (id),
  name        text not null check (length(name) between 1 and 120),
  kind        text not null check (kind in ('period', 'special_day')),
  starts_on   date not null,
  ends_on     date not null,
  color       text not null default 'green' check (color in ('green', 'gold', 'blue', 'orange', 'violet', 'red', 'teal', 'gray')),
  note        text check (length(note) <= 2000),
  created_by  uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  version     int not null default 1,
  check (ends_on >= starts_on),
  check (kind <> 'special_day' or ends_on = starts_on)
);
create index plan_periods_org_idx on app.plan_periods (org_id, starts_on) where archived_at is null;

-- Nhịp: quy tắc lặp + định nghĩa buổi chụp lại lúc tạo (cùng dạng TemplateDefinition), giờ địa phương theo organizations.timezone.
-- rule: {"freq":"weekly","interval":n,"weekday":0..6} | {"freq":"monthly","nth":1..5|-1,"weekday":0..6} | {"freq":"yearly","month":1..12,"day":1..31}; weekday 0 = thứ Hai.
create table app.event_series (
  id          uuid primary key default app.uuid_v7(),
  org_id      uuid not null references app.organizations (id),
  name        text not null check (length(name) between 1 and 200),
  rule        jsonb not null,
  local_time  time not null,
  starts_on   date not null,
  until_on    date,
  location    text check (length(location) <= 300),
  definition  jsonb not null,
  template_id uuid references app.event_templates (id),
  created_by  uuid not null references app.users (id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  version     int not null default 1,
  check (until_on is null or until_on >= starts_on)
);
create index event_series_org_idx on app.event_series (org_id) where archived_at is null;

-- Biến thể: selector {"kind":"date","date":"YYYY-MM-DD"} | {"kind":"nth","nth":1..5|-1} | {"kind":"period","periodId":uuid};
-- action {"type":"skip"} | {"type":"keep"} | {"type":"override","title"?,"localTime"?,"definition"?}.
create table app.series_variants (
  id         uuid primary key default app.uuid_v7(),
  org_id     uuid not null references app.organizations (id),
  series_id  uuid not null references app.event_series (id),
  selector   jsonb not null,
  action     jsonb not null,
  created_by uuid not null references app.users (id),
  created_at timestamptz not null default now()
);
create index series_variants_series_idx on app.series_variants (series_id);

alter table app.events
  add column series_id     uuid references app.event_series (id),
  add column occurrence_on date,
  add column detached_at   timestamptz,
  add constraint events_series_occurrence_ck check ((series_id is null) = (occurrence_on is null));
create unique index events_series_occurrence_uq on app.events (series_id, occurrence_on) where series_id is not null;

alter table app.plan_periods    enable row level security;
alter table app.event_series    enable row level security;
alter table app.series_variants enable row level security;

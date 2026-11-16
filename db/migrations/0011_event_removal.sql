-- 0011_event_removal: "Xoá" buổi đã công bố/đã qua/thuộc nhịp = ẩn mềm (AD-33).
-- Chỉ thêm cột và chỉ mục; không đổi dữ liệu hiện có. Dòng vẫn giữ để lịch sử, thông báo cũ và
-- tham chiếu đa hình (AD-04) không gãy; bản nháp lẻ vẫn xoá cứng như trước.
alter table app.events
  add column deleted_at timestamptz,
  add column deleted_by uuid references app.users (id),
  add constraint events_deleted_by_ck check ((deleted_at is null) = (deleted_by is null));

create index events_org_live_start_idx on app.events (org_id, starts_at) where deleted_at is null;

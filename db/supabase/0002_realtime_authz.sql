-- Phân quyền kênh Realtime riêng (private channel) — EVENT_API_CONTRACTS phụ lục, OD-19 phương án (b).
-- Đặc thù Supabase (AD-29): dùng realtime.messages, realtime.topic(), auth.jwt().
--
-- Chủ đề kênh:
--   user:{users.id}   chỉ chính người đó
--   group:{groups.id} thành viên nhóm (membership tổ chức active, nhóm chưa lưu trữ)
--     (hội thoại nhóm; khi có bảng conversations sẽ thêm conversation:{id} theo anchor)
-- Máy khách KHÔNG được gửi broadcast (không có policy insert); chỉ Backend gửi qua realtime.send().
-- Sự kiện chỉ mang {type, id, activity_id}, không mang nội dung (AD-10).

-- Schema mới chỉ chủ sở hữu có quyền; chỉ cấp usage cho authenticated.
create schema if not exists rt;
grant usage on schema rt to authenticated;

-- Hàm security definer: đọc được schema app mà không cấp quyền schema app cho máy khách.
create or replace function rt.can_read_topic(topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  uid  uuid;
  kind text := split_part(topic, ':', 1);
  oid  uuid;
begin
  select u.id into uid from app.users u where u.auth_subject = (auth.jwt() ->> 'sub');
  if uid is null then return false; end if;

  begin
    oid := split_part(topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  if kind = 'user' then
    return oid = uid;
  elsif kind = 'group' then
    return exists (
      select 1
        from app.group_members gm
        join app.groups g      on g.id = gm.group_id and g.archived_at is null
        join app.memberships m on m.org_id = gm.org_id and m.user_id = gm.user_id and m.status = 'active'
       where gm.group_id = oid and gm.user_id = uid);
  end if;
  return false;
end $$;

-- EXECUTE mặc định thuộc PUBLIC; vô hại vì anon không có sub nên luôn nhận false.
grant execute on function rt.can_read_topic(text) to authenticated;

create policy rt_receive_broadcast on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and rt.can_read_topic((select realtime.topic())));

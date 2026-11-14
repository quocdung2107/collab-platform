-- Thêm chủ đề kênh conversation:{id} (EVENT_API_CONTRACTS phụ lục, AD-31).
-- anchor group: thành viên nhóm (membership tổ chức active). anchor event/task: bổ sung ở lát sau.
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
  elsif kind = 'conversation' then
    -- Hội thoại nhóm vẫn đọc được khi nhóm đã lưu trữ (chỉ-đọc), nên không lọc archived_at.
    return exists (
      select 1
        from app.conversations c
        join app.group_members gm on gm.group_id = c.anchor_id and gm.user_id = uid
        join app.memberships m    on m.org_id = gm.org_id and m.user_id = uid and m.status = 'active'
       where c.id = oid and c.anchor_type = 'group');
  end if;
  return false;
end $$;

-- Thêm chủ đề event:{id} và conversation:{id} cho anchor event (AD-31, PERMISSION_MODEL §3).
-- rt.can_view_event phản chiếu viewsEvent() trong can.ts: org admin, event_owner,
-- bản nháp → leader của một nhóm trong event_groups; đã publish/huỷ → org: mọi thành viên,
-- groups: thành viên nhóm trong event_groups hoặc người có Assignment đang hiệu lực.
create or replace function rt.can_view_event(uid uuid, eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from app.events e
      join app.memberships m on m.org_id = e.org_id and m.user_id = uid and m.status = 'active'
     where e.id = eid
       and (
         m.role in ('owner', 'admin')
         or exists (select 1 from app.event_owners o where o.event_id = e.id and o.user_id = uid)
         or (e.status = 'draft' and exists (
               select 1 from app.event_groups eg
                 join app.group_members gm on gm.group_id = eg.group_id and gm.user_id = uid and gm.role = 'leader'
                where eg.event_id = e.id))
         or (e.status <> 'draft' and (
               e.visibility = 'org'
               or exists (select 1 from app.event_groups eg
                            join app.group_members gm on gm.group_id = eg.group_id and gm.user_id = uid
                           where eg.event_id = e.id)
               or exists (select 1 from app.assignments a
                           where a.event_id = e.id and a.user_id = uid
                             and a.status in ('requested', 'accepted', 'reconfirm'))))
       ));
$$;
revoke all on function rt.can_view_event(uuid, uuid) from public;

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
  elsif kind = 'event' then
    return rt.can_view_event(uid, oid);
  elsif kind = 'conversation' then
    -- Hội thoại nhóm vẫn đọc được khi nhóm đã lưu trữ (chỉ-đọc), nên không lọc archived_at.
    return exists (
      select 1
        from app.conversations c
        join app.group_members gm on gm.group_id = c.anchor_id and gm.user_id = uid
        join app.memberships m    on m.org_id = gm.org_id and m.user_id = uid and m.status = 'active'
       where c.id = oid and c.anchor_type = 'group')
      or exists (
      select 1 from app.conversations c
       where c.id = oid and c.anchor_type = 'event' and rt.can_view_event(uid, c.anchor_id));
  end if;
  return false;
end $$;

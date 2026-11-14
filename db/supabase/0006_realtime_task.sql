-- 0006: realtime cho Task (S10) — kênh task:{id} và thread anchor task.
-- Phải khớp viewsTask() trong can.ts + taskObjects() trong tasks/access.ts.
create or replace function rt.can_view_task(uid uuid, tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from app.tasks t
      join app.memberships m on m.org_id = t.org_id and m.user_id = uid and m.status = 'active'
     where t.id = tid
       and case
             when t.scope_type = 'event' then rt.can_view_event(uid, t.event_id)
             else m.role in ('owner', 'admin')
               or uid in (t.owner_id, t.assigned_by, t.created_by)
               or exists (select 1 from app.task_collaborators c where c.task_id = t.id and c.user_id = uid)
               or (t.scope_type = 'group' and exists (select 1 from app.group_members gm where gm.group_id = t.group_id and gm.user_id = uid))
           end);
$$;
revoke all on function rt.can_view_task(uuid, uuid) from public, anon, authenticated;

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
  elsif kind = 'task' then
    return rt.can_view_task(uid, oid);
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
       where c.id = oid and c.anchor_type = 'event' and rt.can_view_event(uid, c.anchor_id))
      or exists (
      select 1 from app.conversations c
       where c.id = oid and c.anchor_type = 'task' and rt.can_view_task(uid, c.anchor_id));
  end if;
  return false;
end $$;

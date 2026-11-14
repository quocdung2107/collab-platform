-- 0005: rt.can_view_event (S9) — buổi đã huỷ vẫn cho người có vị trí lúc huỷ xem để đọc thông báo huỷ
-- (F7-T8, IN-28). Phải khớp viewsEvent() trong can.ts + eventObjects() trong scheduling/access.ts.
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
                             and (a.status in ('requested', 'accepted', 'reconfirm')
                                  or (a.status = 'cancelled' and a.cancel_reason = 'event_cancelled')))))
       ));
$$;
revoke all on function rt.can_view_event(uuid, uuid) from public, anon, authenticated;

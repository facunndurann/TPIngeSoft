-- Service-only transactions. p_actor comes from a verified Auth token in Edge,
-- never from request JSON. All authorization is rechecked inside the transaction.
create function public.authorize_employee_change(p_actor uuid,p_restaurant uuid,p_user uuid default null,
  p_roles public.member_role[] default '{}',p_global boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare actor_owner boolean;
begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') || jsonb_build_object('sub',p_actor))::text,true);
  if not public.has_permission(p_restaurant,'employees.manage') then raise exception 'FORBIDDEN'; end if;
  select exists(select 1 from restaurant_members where user_id=p_actor and restaurant_id=p_restaurant
    and role='owner' and is_active) into actor_owner;
  if p_roles && array['owner','staff']::public.member_role[]
    or (not actor_owner and 'manager' = any(p_roles)) then raise exception 'FORBIDDEN'; end if;
  if p_user is not null then
    if not exists(select 1 from profiles where id=p_user) then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from restaurant_members where user_id=p_user and
      (role='owner' or (not actor_owner and role='manager'))) then raise exception 'FORBIDDEN'; end if;
    if p_global and exists(select 1 from restaurant_members where user_id=p_user
      and not public.has_permission(restaurant_id,'employees.manage')) then raise exception 'FORBIDDEN'; end if;
    -- Attaching an existing account also requires authority over its current
    -- memberships; a restaurant cannot claim somebody by guessing a username.
    if not exists(select 1 from restaurant_members where user_id=p_user and restaurant_id=p_restaurant)
      and exists(select 1 from restaurant_members where user_id=p_user
        and not public.has_permission(restaurant_id,'employees.manage')) then raise exception 'FORBIDDEN'; end if;
  end if;
  return true;
end;
$$;

create function public.save_employee_account(p_actor uuid,p_restaurant uuid,p_user uuid,
  p_full_name text,p_roles public.member_role[],p_branches uuid[],p_active boolean,
  p_username text default null,p_legacy uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; existing_name text;
begin
  select full_name into existing_name from profiles where id=p_user for update;
  perform public.authorize_employee_change(p_actor,p_restaurant,
    case when existing_name is null then null else p_user end,p_roles,
    existing_name is distinct from btrim(p_full_name));
  if coalesce(cardinality(p_roles),0)=0 or coalesce(cardinality(p_branches),0)=0
    or p_active is null or length(btrim(p_full_name)) not between 1 and 100
    or p_roles && array['owner','staff']::public.member_role[]
    or array_position(p_roles,null) is not null or array_position(p_branches,null) is not null
    or (cardinality(p_roles)>1 and 'manager'=any(p_roles)) then raise exception 'INVALID_REQUEST'; end if;
  if exists(select 1 from unnest(p_branches) bid where not exists(
    select 1 from branches where id=bid and restaurant_id=p_restaurant and is_active))
    then raise exception 'FORBIDDEN'; end if;
  if existing_name is null then
    insert into profiles(id,username_normalized,full_name)
      values(p_user,lower(btrim(p_username)),btrim(p_full_name));
  elsif existing_name is distinct from btrim(p_full_name) then
    update profiles set full_name=btrim(p_full_name),updated_at=now() where id=p_user;
  end if;
  insert into restaurant_members(restaurant_id,user_id,role,additional_roles,is_active)
    values(p_restaurant,p_user,p_roles[1],p_roles[2:cardinality(p_roles)],p_active)
    on conflict(restaurant_id,user_id) do update set role=excluded.role,
      additional_roles=excluded.additional_roles,is_active=excluded.is_active returning id into mid;
  delete from branch_memberships where membership_id=mid;
  insert into branch_memberships(membership_id,restaurant_id,branch_id)
    select mid,p_restaurant,bid from (select distinct unnest(p_branches) bid) b;
  if p_legacy is not null then
    update pos_employees set is_active=false,migrated_user_id=p_user,updated_at=now()
      where id=p_legacy and restaurant_id=p_restaurant and migrated_user_id is null;
    if not found then raise exception 'INVALID_LEGACY_EMPLOYEE'; end if;
  end if;
  insert into pos_audit_log(restaurant_id,actor_user_id,user_id,action,details)
    values(p_restaurant,p_actor,p_actor,case when existing_name is null then 'account.created' else 'account.updated' end,
      jsonb_build_object('accountId',p_user,'fullName',btrim(p_full_name),'roles',p_roles,'branches',p_branches,'active',p_active,'legacyId',p_legacy));
  return p_user;
end;
$$;

create function public.audit_employee_password_reset(p_actor uuid,p_restaurant uuid,p_user uuid,p_completed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.authorize_employee_change(p_actor,p_restaurant,p_user,'{}',true);
  insert into pos_audit_log(restaurant_id,actor_user_id,user_id,action,details)
    values(p_restaurant,p_actor,p_actor,case when p_completed then 'account.password_reset' else 'account.password_reset_requested' end,jsonb_build_object('accountId',p_user));
end;
$$;

create function public.list_employee_accounts(p_restaurant uuid)
returns table(user_id uuid,username text,full_name text,roles public.member_role[],is_active boolean,branch_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_restaurant,'employees.manage') then raise exception 'FORBIDDEN'; end if;
  return query select p.id,p.username_normalized,p.full_name,array[m.role] || m.additional_roles,m.is_active,
    array(select bm.branch_id from branch_memberships bm where bm.membership_id=m.id)
    from restaurant_members m join profiles p on p.id=m.user_id
    where m.restaurant_id=p_restaurant order by p.full_name;
end;
$$;
revoke all on function public.authorize_employee_change(uuid,uuid,uuid,public.member_role[],boolean),
  public.save_employee_account(uuid,uuid,uuid,text,public.member_role[],uuid[],boolean,text,uuid),
  public.audit_employee_password_reset(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.authorize_employee_change(uuid,uuid,uuid,public.member_role[],boolean),
  public.save_employee_account(uuid,uuid,uuid,text,public.member_role[],uuid[],boolean,text,uuid),
  public.audit_employee_password_reset(uuid,uuid,uuid,boolean) to service_role;
revoke all on function public.list_employee_accounts(uuid) from public,anon;
grant execute on function public.list_employee_accounts(uuid) to authenticated;

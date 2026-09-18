create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username_normalized text not null unique,
  full_name text not null check (length(btrim(full_name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_username check (
    username_normalized = lower(btrim(username_normalized)) and
    username_normalized ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'
  )
);
create unique index profiles_username_case_insensitive on public.profiles(lower(username_normalized));
alter table public.profiles enable row level security;
alter table public.restaurant_members add column is_active boolean not null default true;
alter table public.restaurant_members add column additional_roles public.member_role[] not null default '{}';
alter table public.restaurant_members add constraint operational_additional_roles check (
  not (additional_roles && array['owner','manager']::public.member_role[])
);
alter table public.restaurant_members add constraint membership_restaurant_unique unique(id, restaurant_id);
alter table public.branches add constraint branch_restaurant_unique unique(id, restaurant_id);
create table public.branch_memberships (
  membership_id uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  primary key(membership_id, branch_id),
  foreign key(membership_id, restaurant_id) references public.restaurant_members(id, restaurant_id) on delete cascade,
  foreign key(branch_id, restaurant_id) references public.branches(id, restaurant_id) on delete cascade
);
alter table public.branch_memberships enable row level security;
-- Preserve the existing staff scope. New employees always have explicit branches.
insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
select m.id, m.restaurant_id, b.id from public.restaurant_members m
join public.branches b on b.restaurant_id = m.restaurant_id where m.role = 'staff';

create table public.role_permissions (
  role public.member_role not null,
  permission text not null,
  primary key(role, permission)
);
alter table public.role_permissions enable row level security;
insert into public.role_permissions
select r::public.member_role, p from unnest(array['owner','manager','supervisor','staff']) r
cross join unnest(array['orders.read','orders.accept','orders.deliver','orders.prepare',
  'orders.cancel','orders.revert','floor.read','history.read','payments.read','sessions.close']) p;
insert into public.role_permissions
select r::public.member_role, p from unnest(array['owner','manager']) r
cross join unnest(array['admin.manage','employees.manage','audit.read']) p;
insert into public.role_permissions
select 'waiter'::public.member_role, unnest(array['orders.read','orders.accept','orders.deliver','floor.read','history.read']);
insert into public.role_permissions
select 'cashier'::public.member_role, unnest(array['orders.read','floor.read','history.read','payments.read','sessions.close']);
insert into public.role_permissions
select 'kitchen'::public.member_role, unnest(array['orders.read','orders.prepare']);

create function public.has_permission(rid uuid, permission_name text, bid uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from restaurant_members m
    join role_permissions rp on rp.role = any(array[m.role] || m.additional_roles)
    where m.user_id = auth.uid() and m.restaurant_id = rid and m.is_active
      and rp.permission = permission_name
      and (bid is null or exists (
        select 1 from branch_memberships bm join branches b on b.id = bm.branch_id
        where bm.membership_id = m.id and bm.branch_id = bid and b.is_active
      ))
  );
$$;
create or replace function public.is_restaurant_admin(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission(rid, 'admin.manage');
$$;
-- Old generic checks must not grant employees restaurant-wide operational access.
create or replace function public.is_restaurant_member(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_restaurant_admin(rid);
$$;
create function public.can_read_session(sid uuid, permission_name text default 'orders.read')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from table_sessions s join tables t on t.id = s.table_id
    where s.id = sid and t.restaurant_id = s.restaurant_id and (
      (public.is_restaurant_admin(s.restaurant_id) and not exists(select 1 from profiles where id=auth.uid())) or
      public.has_permission(s.restaurant_id, permission_name, t.branch_id)
    ));
$$;
create function public.employee_catalog_access(rid uuid, bid uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from profiles where id = auth.uid())
    or public.is_restaurant_admin(rid)
    or public.has_permission(rid, 'orders.read', bid);
$$;

create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "read managed profiles" on public.profiles for select to authenticated using (
  exists(select 1 from restaurant_members m where m.user_id = profiles.id
    and public.has_permission(m.restaurant_id, 'employees.manage'))
);
create policy "read branch assignments" on public.branch_memberships for select to authenticated using (
  exists(select 1 from restaurant_members m where m.id = membership_id
    and (m.user_id = auth.uid() or public.has_permission(m.restaurant_id, 'employees.manage')))
);
revoke all on public.profiles, public.branch_memberships, public.role_permissions from anon, authenticated;
grant select on public.profiles, public.branch_memberships to authenticated;
grant all on public.profiles, public.branch_memberships, public.role_permissions to service_role;

drop policy "bootstrap or member-invited insert" on public.restaurant_members;
drop policy "admins delete members" on public.restaurant_members;
-- Membership writes now use trusted provisioning; onboarding has its own atomic RPC.
revoke insert, update, delete on public.restaurant_members from anon, authenticated;
drop policy "authenticated create restaurant" on public.restaurants;
revoke insert on public.restaurants from anon, authenticated;

create function public.create_restaurant(p_name text, p_slug text, p_description text, p_menu_design text, p_branch_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    or exists(select 1 from profiles where id = auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if length(btrim(p_name)) not between 1 and 100 or length(btrim(p_branch_name)) not between 1 and 100 then
    raise exception 'INVALID_REQUEST'; end if;
  insert into restaurants(name, slug, description, menu_design)
    values(p_name, p_slug, p_description, p_menu_design::public.menu_design) returning id into rid;
  insert into restaurant_members(restaurant_id,user_id,role) values(rid,auth.uid(),'owner');
  insert into branches(restaurant_id,name) values(rid,p_branch_name);
  insert into pos_integrations(restaurant_id,type) values(rid,'internal');
  return rid;
end;
$$;

create function public.get_pos_contexts()
returns table(restaurant_id uuid, restaurant_name text, branch_id uuid, branch_name text,
  full_name text, permissions text[])
language sql stable security definer set search_path = public as $$
  select r.id, r.name, b.id, b.name, p.full_name,
    array(select distinct rp.permission from role_permissions rp
      where rp.role = any(array[m.role] || m.additional_roles) and rp.permission not in ('admin.manage','employees.manage','audit.read'))
  from restaurant_members m join profiles p on p.id = m.user_id
  join restaurants r on r.id = m.restaurant_id
  join branch_memberships bm on bm.membership_id = m.id
  join branches b on b.id = bm.branch_id and b.restaurant_id = m.restaurant_id
  where m.user_id = auth.uid() and m.is_active and b.is_active
    and public.has_permission(r.id,'orders.read',b.id)
  order by r.name,b.name;
$$;

alter table public.pos_audit_log add column actor_user_id uuid references auth.users(id) on delete set null;
alter table public.pos_audit_log add column branch_id uuid references public.branches(id) on delete set null;
alter table public.table_sessions add column assigned_user_id uuid references public.profiles(id) on delete set null;
alter table public.pos_employees add column migrated_user_id uuid references public.profiles(id) on delete set null;
drop policy "members read pos audit" on public.pos_audit_log;
create policy "admins read pos audit" on public.pos_audit_log for select to authenticated
using(public.has_permission(restaurant_id,'audit.read'));
drop policy "members read pos employees" on public.pos_employees;
create policy "admins read legacy employees" on public.pos_employees for select to authenticated
using(public.has_permission(restaurant_id,'employees.manage'));
grant select(migrated_user_id) on public.pos_employees to authenticated;

-- Preserve legacy records but retire client access to PIN and identity-spoofing signatures.
revoke execute on function public.verify_pos_pin(uuid,text) from public,anon,authenticated;
revoke execute on function public.upsert_pos_employee(uuid,text,text,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.delete_pos_employee(uuid,uuid) from public,anon,authenticated;
drop function public.pos_transition_order(uuid,public.order_status,uuid);
drop function public.pos_close_table_session(uuid,uuid);
drop function public.record_pos_action(uuid,uuid,text,uuid,uuid,jsonb);

-- No employee can use publicly readable catalog rows to cross their assigned scope.
do $$
declare tbl text;
begin
  foreach tbl in array array['branches','tables','floor_sections','menu_categories','products',
    'product_ingredients','modifier_groups','modifier_options','product_modifier_groups'] loop
    execute format('create policy employee_scope on public.%I as restrictive for select to authenticated using (public.employee_catalog_access(restaurant_id, %s))',
      tbl, case when tbl='branches' then 'id' when tbl in ('tables','floor_sections') then 'branch_id' else 'null' end);
  end loop;
end;
$$;
create policy employee_scope on public.restaurants as restrictive for select to authenticated
using(public.employee_catalog_access(id));

drop policy "participants and members read sessions" on public.table_sessions;
create policy "scoped read sessions" on public.table_sessions for select using (
  public.is_session_participant(id) or public.can_read_session(id)
);
drop policy "participants and members read participants" on public.session_participants;
create policy "scoped read participants" on public.session_participants for select using (
  public.is_session_participant(session_id) or public.can_read_session(session_id)
);
drop policy "participants and members read orders" on public.orders;
create policy "scoped read orders" on public.orders for select using (
  public.is_session_participant(session_id) or public.can_read_session(session_id)
);
drop policy "participants and members read payments" on public.payments;
create policy "scoped read payments" on public.payments for select using (
  public.is_session_participant(session_id) or public.can_read_session(session_id,'payments.read')
);
drop policy "read order items via order" on public.order_items;
create policy "scoped read items" on public.order_items for select using (
  exists(select 1 from public.orders o where o.id = order_id)
);
drop policy "read order item modifiers via order" on public.order_item_modifiers;
create policy "scoped read modifiers" on public.order_item_modifiers for select using (
  exists(select 1 from public.order_items i where i.id = order_item_id)
);
drop policy "read removed ingredients via order" on public.order_item_removed_ingredients;
create policy "scoped read removed ingredients" on public.order_item_removed_ingredients for select using (
  exists(select 1 from public.order_items i where i.id = order_item_id)
);

revoke all on function public.has_permission(uuid,text,uuid), public.can_read_session(uuid,text),
  public.employee_catalog_access(uuid,uuid), public.get_pos_contexts(),
  public.create_restaurant(text,text,text,text,text) from public,anon;
grant execute on function public.has_permission(uuid,text,uuid), public.can_read_session(uuid,text),
  public.employee_catalog_access(uuid,uuid), public.get_pos_contexts(),
  public.create_restaurant(text,text,text,text,text) to authenticated,service_role;

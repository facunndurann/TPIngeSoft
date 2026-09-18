-- ============================================================
-- MI-61: desacoplar el POS del panel administrativo.
--
-- Dos capas de identidad, porque el POS vive en un dispositivo compartido:
--   1. Miembro del restaurante (auth.users + restaurant_members).
--      'owner' administra (carta, precios, mesas, configuración);
--      'staff' solo opera el salón. Antes toda la RLS usaba
--      is_restaurant_member, así que 'staff' podía editar la carta.
--   2. Empleado POS (pos_employees): la persona que atiende, identificada
--      por PIN sobre la sesión del dispositivo. No tiene cuenta propia.
--
-- Las acciones operativas quedan auditadas en pos_audit_log con el empleado
-- validado y el usuario dueño del dispositivo.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Rol administrativo ----------

create or replace function public.is_restaurant_admin(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_members
    where restaurant_id = rid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ---------- Empleados del POS ----------

create table public.pos_employees (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  full_name text not null,
  -- bcrypt: el PIN nunca viaja ni se guarda en claro
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, full_name)
);

create index on public.pos_employees (restaurant_id) where is_active;

-- ---------- Auditoría de operación ----------

create table public.pos_audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- empleado validado por PIN; null si operó el administrador sin empleados cargados
  employee_id uuid references public.pos_employees (id) on delete set null,
  -- dueño de la sesión del dispositivo, siempre presente
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  order_id uuid references public.orders (id) on delete set null,
  session_id uuid references public.table_sessions (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index on public.pos_audit_log (restaurant_id, created_at desc);

-- ---------- RLS ----------

alter table public.pos_employees enable row level security;
alter table public.pos_audit_log enable row level security;

-- Cualquier miembro necesita la lista para elegir quién opera; el hash del PIN
-- queda fuera del grant de columnas, así no sale nunca por PostgREST.
create policy "members read pos employees" on public.pos_employees
  for select using (public.is_restaurant_member(restaurant_id));

create policy "members read pos audit" on public.pos_audit_log
  for select using (public.is_restaurant_member(restaurant_id));

revoke all on public.pos_employees from anon, authenticated;
grant select (id, restaurant_id, full_name, is_active, created_at, updated_at)
  on public.pos_employees to authenticated;

revoke all on public.pos_audit_log from anon, authenticated;
grant select on public.pos_audit_log to authenticated;

-- ---------- Separar administración de operación ----------
-- Escritura de carta, precios, estructura y configuración: solo administradores.
-- Lo operativo (sesiones, comandas, cobros) sigue disponible para todo miembro.

drop policy "members update restaurant" on public.restaurants;
create policy "admins update restaurant" on public.restaurants
  for update using (public.is_restaurant_admin(id));

drop policy "members delete members" on public.restaurant_members;
create policy "admins delete members" on public.restaurant_members
  for delete using (public.is_restaurant_admin(restaurant_id));

drop policy "members write branches" on public.branches;
create policy "admins write branches" on public.branches
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write tables" on public.tables;
create policy "admins write tables" on public.tables
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write categories" on public.menu_categories;
create policy "admins write categories" on public.menu_categories
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write products" on public.products;
create policy "admins write products" on public.products
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write ingredients" on public.product_ingredients;
create policy "admins write ingredients" on public.product_ingredients
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write modifier groups" on public.modifier_groups;
create policy "admins write modifier groups" on public.modifier_groups
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write modifier options" on public.modifier_options;
create policy "admins write modifier options" on public.modifier_options
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members write product modifier groups" on public.product_modifier_groups;
create policy "admins write product modifier groups" on public.product_modifier_groups
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members manage pos integrations" on public.pos_integrations;
create policy "admins manage pos integrations" on public.pos_integrations
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy "members manage pos mappings" on public.pos_product_mappings;
create policy "admins manage pos mappings" on public.pos_product_mappings
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

-- Storage de fotos: el bucket es común a todos los restaurantes, así que
-- alcanza con exigir que quien escribe administre algún restaurante.
drop policy "members write product images" on storage.objects;
create policy "admins write product images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.restaurant_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy "members update product images" on storage.objects;
create policy "admins update product images" on storage.objects
  for update to authenticated using (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.restaurant_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy "members delete product images" on storage.objects;
create policy "admins delete product images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.restaurant_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ---------- Alta y edición de empleados (solo administradores) ----------

create or replace function public.upsert_pos_employee(
  p_restaurant_id uuid,
  p_full_name text,
  p_pin text default null,
  p_employee_id uuid default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(p_full_name), '');
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_restaurant_id is null or v_name is null then raise exception 'INVALID_REQUEST'; end if;
  if not public.is_restaurant_admin(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  if p_pin is not null then
    if p_pin !~ '^[0-9]{4,8}$' then raise exception 'INVALID_PIN'; end if;
    -- Dos empleados activos con el mismo PIN harían ambiguo el desbloqueo.
    if exists (
      select 1 from public.pos_employees e
      where e.restaurant_id = p_restaurant_id
        and e.is_active
        and (p_employee_id is null or e.id <> p_employee_id)
        and e.pin_hash = crypt(p_pin, e.pin_hash)
    ) then raise exception 'PIN_TAKEN'; end if;
    v_hash := crypt(p_pin, gen_salt('bf'));
  end if;

  if p_employee_id is null then
    if v_hash is null then raise exception 'INVALID_PIN'; end if;
    begin
      insert into public.pos_employees(restaurant_id, full_name, pin_hash, is_active)
        values(p_restaurant_id, v_name, v_hash, coalesce(p_is_active, true))
        returning id into v_id;
    exception when unique_violation then raise exception 'NAME_TAKEN';
    end;
    insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action, details)
      values(p_restaurant_id, v_id, auth.uid(), 'employee.created',
        jsonb_build_object('fullName', v_name));
    return v_id;
  end if;

  begin
    update public.pos_employees
      set full_name = v_name,
          is_active = coalesce(p_is_active, is_active),
          pin_hash = coalesce(v_hash, pin_hash),
          updated_at = now()
      where id = p_employee_id and restaurant_id = p_restaurant_id
      returning id into v_id;
  exception when unique_violation then raise exception 'NAME_TAKEN';
  end;
  if v_id is null then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action, details)
    values(p_restaurant_id, v_id, auth.uid(), 'employee.updated',
      jsonb_build_object('fullName', v_name, 'isActive', coalesce(p_is_active, true),
        'pinChanged', v_hash is not null));
  return v_id;
end;
$$;

-- ---------- Validación de PIN ----------

create or replace function public.verify_pos_pin(p_restaurant_id uuid, p_pin text)
returns table (id uuid, full_name text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_employee public.pos_employees;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_restaurant_id is null or p_pin is null then raise exception 'INVALID_REQUEST'; end if;
  -- Operar el POS es de cualquier miembro; administrar empleados, solo del owner.
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  select * into v_employee from public.pos_employees e
    where e.restaurant_id = p_restaurant_id
      and e.is_active
      and e.pin_hash = crypt(p_pin, e.pin_hash)
    limit 1;
  if not found then raise exception 'INVALID_PIN'; end if;

  insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action)
    values(p_restaurant_id, v_employee.id, auth.uid(), 'pos.unlocked');

  id := v_employee.id;
  full_name := v_employee.full_name;
  return next;
end;
$$;

-- ---------- Operación auditada ----------

-- Interna: valida que el empleado exista, esté activo y sea del restaurante.
create or replace function public.record_pos_action(
  p_restaurant_id uuid,
  p_employee_id uuid,
  p_action text,
  p_order_id uuid default null,
  p_session_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_employee_id is not null and not exists (
    select 1 from public.pos_employees
    where id = p_employee_id and restaurant_id = p_restaurant_id and is_active
  ) then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  insert into public.pos_audit_log(
    restaurant_id, employee_id, user_id, action, order_id, session_id, details)
    values(p_restaurant_id, p_employee_id, auth.uid(), p_action, p_order_id, p_session_id,
      coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Envoltorios del POS: misma validación de transition_order/close_table_session
-- (siguen siendo la fuente de verdad) más el registro de quién operó.
create or replace function public.pos_transition_order(
  p_order_id uuid,
  p_status public.order_status,
  p_employee_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant uuid;
  v_from public.order_status;
  v_id uuid;
begin
  select o.restaurant_id, o.status into v_restaurant, v_from
    from public.orders o where o.id = p_order_id;

  v_id := public.transition_order(p_order_id, p_status);

  perform public.record_pos_action(
    v_restaurant, p_employee_id, 'order.transition', p_order_id, null,
    jsonb_build_object('from', v_from, 'to', p_status));
  return v_id;
end;
$$;

create or replace function public.pos_close_table_session(
  p_session_id uuid,
  p_employee_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant uuid;
  v_id uuid;
begin
  select s.restaurant_id into v_restaurant
    from public.table_sessions s where s.id = p_session_id;

  v_id := public.close_table_session(p_session_id);

  perform public.record_pos_action(
    v_restaurant, p_employee_id, 'session.closed', null, v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- ---------- Privilegios ----------

revoke all on function public.is_restaurant_admin(uuid) from public, anon;
grant execute on function public.is_restaurant_admin(uuid) to authenticated;

revoke all on function public.upsert_pos_employee(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.upsert_pos_employee(uuid, text, text, uuid, boolean) to authenticated;

revoke all on function public.verify_pos_pin(uuid, text) from public, anon;
grant execute on function public.verify_pos_pin(uuid, text) to authenticated;

-- record_pos_action solo se usa desde los envoltorios: nadie escribe auditoría a mano.
revoke all on function public.record_pos_action(uuid, uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.pos_transition_order(uuid, public.order_status, uuid) from public, anon;
grant execute on function public.pos_transition_order(uuid, public.order_status, uuid) to authenticated;

revoke all on function public.pos_close_table_session(uuid, uuid) from public, anon;
grant execute on function public.pos_close_table_session(uuid, uuid) to authenticated;

-- ---------- Comentarios ----------

comment on function public.is_restaurant_admin(uuid) is
  'True si auth.uid() es owner del restaurante. Separa administración de operación.';
comment on function public.upsert_pos_employee(uuid, text, text, uuid, boolean) is
  'Alta/edición de empleados POS; solo owner. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, INVALID_PIN, PIN_TAKEN, NAME_TAKEN, EMPLOYEE_NOT_FOUND.';
comment on function public.verify_pos_pin(uuid, text) is
  'Desbloquea el POS con PIN y audita el ingreso. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, INVALID_PIN.';
comment on function public.pos_transition_order(uuid, public.order_status, uuid) is
  'transition_order + auditoría del operador. Errores: los de transition_order más EMPLOYEE_NOT_FOUND.';
comment on function public.pos_close_table_session(uuid, uuid) is
  'close_table_session + auditoría del operador. Errores: los de close_table_session más EMPLOYEE_NOT_FOUND.';

-- Guardados del panel admin como RPCs transaccionales.
--
-- El navegador encadenaba varios inserts/updates por guardado (producto y un
-- request por ingrediente, grupo y opciones, restaurante + membresía +
-- sucursal + POS, swap de categorías con dos updates). Si un paso intermedio
-- fallaba quedaba todo a medias, y el reintento duplicaba el producto o el
-- grupo, o chocaba con el slug ya tomado. Cada RPC recibe el estado completo
-- del formulario y lo aplica en una sola transacción, igual que submit_order.
--
-- Errores (traducidos en apps/admin/src/lib/rpc-error.ts):
--   AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, SLUG_TAKEN y
--   STALE_DATA: el formulario referencia filas que ya no existen o que no
--   pertenecen a ese restaurante, grupo o producto.

-- ---------- Alta de restaurante ----------

-- Dar de alta un restaurante pasa solo por create_restaurant. Estas políticas
-- permitían que cualquier usuario authenticated (incluidos los comensales con
-- sesión anónima) insertara restaurantes y se agregara como su primer miembro.
drop policy "authenticated create restaurant" on public.restaurants;
drop policy "bootstrap or member-invited insert" on public.restaurant_members;

create function public.create_restaurant(
  p_name text,
  p_slug text,
  p_menu_design public.menu_design,
  p_branch_name text,
  p_description text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if (select is_anonymous from auth.users where id = auth.uid()) is not false then
    raise exception 'FORBIDDEN';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_branch_name), '') is null
    or p_menu_design is null or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'INVALID_REQUEST';
  end if;

  begin
    insert into public.restaurants(name, slug, description, menu_design)
      values (trim(p_name), p_slug, nullif(trim(p_description), ''), p_menu_design)
      returning id into v_restaurant_id;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN';
  end;
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values (v_restaurant_id, auth.uid(), 'owner');
  insert into public.branches(restaurant_id, name)
    values (v_restaurant_id, trim(p_branch_name));
  insert into public.pos_integrations(restaurant_id, type)
    values (v_restaurant_id, 'internal');
  return v_restaurant_id;
end;
$$;

-- ---------- Orden de categorías ----------

create function public.reorder_categories(p_restaurant_id uuid, p_category_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  -- Serializa reordenamientos concurrentes del mismo restaurante.
  perform 1 from public.menu_categories where restaurant_id = p_restaurant_id for update;
  -- La lista debe ser exactamente las categorías actuales. Comparar ambas listas
  -- ordenadas detecta a la vez faltantes, ajenas y repetidas.
  if (select array_agg(id order by id) from public.menu_categories where restaurant_id = p_restaurant_id)
    is distinct from (select array_agg(id order by id) from unnest(p_category_ids) as id) then
    raise exception 'STALE_DATA';
  end if;

  -- La posición en la lista pasa a ser el sort_order (0..n-1, sin empates).
  update public.menu_categories c set sort_order = o.position - 1
    from unnest(p_category_ids) with ordinality as o(id, position)
    where c.id = o.id;
end;
$$;

-- ---------- Grupo de modificadores con sus opciones ----------

-- p_options: [{ id?, name, price_delta, is_available }] en el orden a guardar.
-- Las opciones del grupo que no vienen en la lista se eliminan.
create function public.save_modifier_group(
  p_restaurant_id uuid,
  p_name text,
  p_min_select integer,
  p_max_select integer,
  p_is_available boolean,
  p_options jsonb,
  p_group_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_group_id uuid := p_group_id;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if nullif(trim(p_name), '') is null or jsonb_typeof(p_options) is distinct from 'array' then
    raise exception 'INVALID_REQUEST';
  end if;
  if jsonb_array_length(p_options) = 0 or exists (
    select 1 from jsonb_array_elements(p_options) o where nullif(trim(o->>'name'), '') is null
  ) then
    raise exception 'INVALID_REQUEST';
  end if;

  if v_group_id is null then
    insert into public.modifier_groups(restaurant_id, name, min_select, max_select, is_available)
      values (p_restaurant_id, trim(p_name), p_min_select, p_max_select, p_is_available)
      returning id into v_group_id;
  else
    update public.modifier_groups
      set name = trim(p_name), min_select = p_min_select, max_select = p_max_select,
        is_available = p_is_available
      where id = v_group_id and restaurant_id = p_restaurant_id;
    if not found then raise exception 'STALE_DATA'; end if;
  end if;

  -- Como la función saltea RLS, cada id recibido tiene que ser de este grupo:
  -- si no, el upsert de abajo podría editar opciones de otro grupo o restaurante.
  if exists (
    select 1 from jsonb_array_elements(p_options) o
    where o->>'id' is not null and not exists (
      select 1 from public.modifier_options existing
      where existing.id = (o->>'id')::uuid and existing.group_id = v_group_id)
  ) then
    raise exception 'STALE_DATA';
  end if;

  delete from public.modifier_options
    where group_id = v_group_id
      and id not in (
        select (o->>'id')::uuid from jsonb_array_elements(p_options) o where o->>'id' is not null);

  insert into public.modifier_options(id, restaurant_id, group_id, name, price_delta, is_available, sort_order)
    select coalesce((o.value->>'id')::uuid, gen_random_uuid()), p_restaurant_id, v_group_id,
      trim(o.value->>'name'), (o.value->>'price_delta')::numeric, (o.value->>'is_available')::boolean,
      o.position - 1
    from jsonb_array_elements(p_options) with ordinality as o(value, position)
  on conflict (id) do update
    set name = excluded.name, price_delta = excluded.price_delta,
      is_available = excluded.is_available, sort_order = excluded.sort_order;

  return v_group_id;
end;
$$;

-- ---------- Producto con ingredientes y grupos asignados ----------

-- p_ingredients: [{ id?, name, is_removable, is_available }] en el orden a guardar.
-- p_group_ids: grupos asignados, en orden. Lo que no viene en las listas se elimina.
create function public.save_product(
  p_restaurant_id uuid,
  p_category_id uuid,
  p_name text,
  p_base_price numeric,
  p_dietary_tags text[],
  p_is_available boolean,
  p_media_urls text[],
  p_ingredients jsonb,
  p_group_ids uuid[],
  p_product_id uuid default null,
  p_description text default null,
  p_food_info text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_product_id uuid := p_product_id;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if nullif(trim(p_name), '') is null or p_base_price is null or p_base_price < 0
    or jsonb_typeof(p_ingredients) is distinct from 'array' then
    raise exception 'INVALID_REQUEST';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_ingredients) i where nullif(trim(i->>'name'), '') is null
  ) then
    raise exception 'INVALID_REQUEST';
  end if;

  if v_product_id is null then
    insert into public.products(restaurant_id, category_id, name, description, base_price,
      food_info, dietary_tags, is_available, media_urls)
    values (p_restaurant_id, p_category_id, trim(p_name), nullif(trim(p_description), ''), p_base_price,
      nullif(trim(p_food_info), ''), coalesce(p_dietary_tags, '{}'), p_is_available,
      coalesce(p_media_urls, '{}'))
    returning id into v_product_id;
  else
    update public.products
      set category_id = p_category_id, name = trim(p_name),
        description = nullif(trim(p_description), ''), base_price = p_base_price,
        food_info = nullif(trim(p_food_info), ''), dietary_tags = coalesce(p_dietary_tags, '{}'),
        is_available = p_is_available, media_urls = coalesce(p_media_urls, '{}')
      where id = v_product_id and restaurant_id = p_restaurant_id;
    if not found then raise exception 'STALE_DATA'; end if;
  end if;

  -- Mismo resguardo que en save_modifier_group: solo ingredientes de este producto.
  if exists (
    select 1 from jsonb_array_elements(p_ingredients) i
    where i->>'id' is not null and not exists (
      select 1 from public.product_ingredients existing
      where existing.id = (i->>'id')::uuid and existing.product_id = v_product_id)
  ) then
    raise exception 'STALE_DATA';
  end if;

  delete from public.product_ingredients
    where product_id = v_product_id
      and id not in (
        select (i->>'id')::uuid from jsonb_array_elements(p_ingredients) i where i->>'id' is not null);

  insert into public.product_ingredients(id, restaurant_id, product_id, name, is_removable, is_available, sort_order)
    select coalesce((i.value->>'id')::uuid, gen_random_uuid()), p_restaurant_id, v_product_id,
      trim(i.value->>'name'), (i.value->>'is_removable')::boolean, (i.value->>'is_available')::boolean,
      i.position - 1
    from jsonb_array_elements(p_ingredients) with ordinality as i(value, position)
  on conflict (id) do update
    set name = excluded.name, is_removable = excluded.is_removable,
      is_available = excluded.is_available, sort_order = excluded.sort_order;

  delete from public.product_modifier_groups
    where product_id = v_product_id and group_id <> all(coalesce(p_group_ids, '{}'));

  insert into public.product_modifier_groups(restaurant_id, product_id, group_id, sort_order)
    select p_restaurant_id, v_product_id, g.id, g.position - 1
    from unnest(p_group_ids) with ordinality as g(id, position)
  on conflict (product_id, group_id) do update set sort_order = excluded.sort_order;

  return v_product_id;
exception
  -- Categoría o grupo inexistente o de otro restaurante (FKs compuestas).
  when foreign_key_violation then raise exception 'STALE_DATA';
end;
$$;

revoke all on function public.create_restaurant(text, text, public.menu_design, text, text) from public, anon;
revoke all on function public.reorder_categories(uuid, uuid[]) from public, anon;
revoke all on function public.save_modifier_group(uuid, text, integer, integer, boolean, jsonb, uuid) from public, anon;
revoke all on function public.save_product(uuid, uuid, text, numeric, text[], boolean, text[], jsonb, uuid[], uuid, text, text) from public, anon;
grant execute on function public.create_restaurant(text, text, public.menu_design, text, text) to authenticated;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated;
grant execute on function public.save_modifier_group(uuid, text, integer, integer, boolean, jsonb, uuid) to authenticated;
grant execute on function public.save_product(uuid, uuid, text, numeric, text[], boolean, text[], jsonb, uuid[], uuid, text, text) to authenticated;

comment on function public.create_restaurant(text, text, public.menu_design, text, text) is
  'Atomic onboarding: restaurant, owner membership, first branch and internal POS. Non-anonymous users only. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, SLUG_TAKEN.';
comment on function public.reorder_categories(uuid, uuid[]) is
  'Members only; the list must contain exactly the current categories. Errors: AUTH_REQUIRED, FORBIDDEN, STALE_DATA.';
comment on function public.save_modifier_group(uuid, text, integer, integer, boolean, jsonb, uuid) is
  'Members only; creates or replaces a group and its full option list atomically. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, STALE_DATA.';
comment on function public.save_product(uuid, uuid, text, numeric, text[], boolean, text[], jsonb, uuid[], uuid, text, text) is
  'Members only; creates or replaces a product with its full ingredient list and group assignments atomically. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, STALE_DATA.';

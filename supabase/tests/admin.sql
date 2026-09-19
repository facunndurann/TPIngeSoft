-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

-- Ejecuta la sentencia y exige que falle con un mensaje que cumpla el patrón LIKE.
create function pg_temp.expect_error(statement text, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    execute statement;
  exception when others then actual := sqlerrm;
  end;
  if actual is null or actual not like expected then
    raise exception 'Expected "%" from %, got %', expected, statement, coalesce(actual, 'success');
  end if;
end;
$$;

create function pg_temp.save_product_sql(
  restaurant uuid, category uuid, ingredients jsonb, group_ids uuid[], product uuid default null
) returns text language sql as $$
  select format(
    'select public.save_product(p_restaurant_id => %L, p_category_id => %L, p_name => %L, '
      || 'p_base_price => 10, p_dietary_tags => %L, p_is_available => true, p_media_urls => %L, '
      || 'p_ingredients => %L, p_group_ids => %L, p_product_id => %L)',
    restaurant, category, 'Hamburguesa', '{}', '{}', ingredients, group_ids, product)
$$;

-- Hace fallar el último paso del alta para comprobar que no queda nada a medias.
create function public.test_fail_insert() returns trigger language plpgsql as $$
begin
  raise exception 'SIMULATED_FAILURE';
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  new_slug text := 'admin-sql-' || replace(gen_random_uuid()::text, '-', '');
  restaurant uuid;
  other_restaurant uuid;
  categories uuid[];
  foreign_category uuid;
  foreign_group uuid;
  foreign_option uuid;
  foreign_product uuid;
  foreign_ingredient uuid;
  modifier_group uuid;
  kept_option uuid;
  product uuid;
  kept_ingredient uuid;
  saved uuid;
  group_count integer;
begin
  insert into auth.users(id, aud, role, is_anonymous) values
    (owner_id, 'authenticated', 'authenticated', false),
    (diner, 'authenticated', 'authenticated', true),
    (outsider, 'authenticated', 'authenticated', false);

  -- ---------- create_restaurant ----------
  if exists (select 1 from pg_policies where schemaname = 'public'
      and tablename in ('restaurants', 'restaurant_members') and cmd in ('INSERT', 'ALL')) then
    raise exception 'Restaurants or memberships can still be inserted without create_restaurant';
  end if;
  perform set_config('request.jwt.claim.sub', diner::text, true);
  begin
    set local role authenticated;
    insert into public.restaurants(name, slug) values ('Direct', new_slug);
    raise exception 'A diner can still insert restaurants directly';
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.expect_error(format(
    'select public.create_restaurant(p_name => %L, p_slug => %L, p_menu_design => %L, p_branch_name => %L)',
    'Diner place', new_slug, 'oliva', 'Centro'), 'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform pg_temp.expect_error(format(
    'select public.create_restaurant(p_name => %L, p_slug => %L, p_menu_design => %L, p_branch_name => %L)',
    'Bad slug', 'Not A Slug', 'oliva', 'Centro'), 'INVALID_REQUEST');

  create trigger test_fail_insert before insert on public.pos_integrations
    for each row execute function public.test_fail_insert();
  perform pg_temp.expect_error(format(
    'select public.create_restaurant(p_name => %L, p_slug => %L, p_menu_design => %L, p_branch_name => %L)',
    'Admin SQL', new_slug, 'oliva', 'Centro'), 'SIMULATED_FAILURE');
  drop trigger test_fail_insert on public.pos_integrations;
  if exists (select 1 from public.restaurants r where r.slug = new_slug) then
    raise exception 'A failed onboarding left the restaurant (and its slug) behind';
  end if;

  restaurant := public.create_restaurant(p_name => ' Admin SQL ', p_slug => new_slug,
    p_menu_design => 'brasas', p_branch_name => ' Centro ', p_description => '  ');
  if not exists (select 1 from public.restaurants r where r.id = restaurant
      and r.name = 'Admin SQL' and r.description is null and r.menu_design = 'brasas')
    or not exists (select 1 from public.restaurant_members m
      where m.restaurant_id = restaurant and m.user_id = owner_id and m.role = 'owner')
    or not exists (select 1 from public.branches b where b.restaurant_id = restaurant and b.name = 'Centro')
    or not exists (select 1 from public.pos_integrations p
      where p.restaurant_id = restaurant and p.type = 'internal') then
    raise exception 'create_restaurant must create restaurant, owner, branch and internal POS';
  end if;
  perform pg_temp.expect_error(format(
    'select public.create_restaurant(p_name => %L, p_slug => %L, p_menu_design => %L, p_branch_name => %L)',
    'Duplicate', new_slug, 'oliva', 'Centro'), 'SLUG_TAKEN');

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  other_restaurant := public.create_restaurant(p_name => 'Other', p_slug => new_slug || '-other',
    p_menu_design => 'oliva', p_branch_name => 'Otra');
  insert into public.menu_categories(restaurant_id, name) values (other_restaurant, 'Foreign')
    returning id into foreign_category;
  insert into public.modifier_groups(restaurant_id, name) values (other_restaurant, 'Foreign group')
    returning id into foreign_group;
  insert into public.modifier_options(restaurant_id, group_id, name)
    values (other_restaurant, foreign_group, 'Foreign option') returning id into foreign_option;
  insert into public.products(restaurant_id, category_id, name, base_price)
    values (other_restaurant, foreign_category, 'Foreign dish', 1) returning id into foreign_product;
  insert into public.product_ingredients(restaurant_id, product_id, name)
    values (other_restaurant, foreign_product, 'Foreign ingredient') returning id into foreign_ingredient;

  -- ---------- reorder_categories ----------
  -- Mismo sort_order en las tres: el swap anterior de dos updates no podía reordenarlas.
  insert into public.menu_categories(restaurant_id, name) values (restaurant, 'A'), (restaurant, 'B'), (restaurant, 'C');
  select array_agg(c.id order by c.name) into categories
    from public.menu_categories c where c.restaurant_id = restaurant;

  perform pg_temp.expect_error(format('select public.reorder_categories(%L, %L)',
    restaurant, array[categories[3], categories[1], categories[2]]), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.reorder_categories(restaurant, array[categories[3], categories[1], categories[2]]);
  if (select array_agg(c.name order by c.sort_order) from public.menu_categories c where c.restaurant_id = restaurant)
      is distinct from array['C', 'A', 'B']
    or (select count(distinct c.sort_order) from public.menu_categories c where c.restaurant_id = restaurant) <> 3 then
    raise exception 'reorder_categories must store the list order without ties';
  end if;
  perform pg_temp.expect_error(format('select public.reorder_categories(%L, %L)',
    restaurant, array[categories[1], categories[2]]), 'STALE_DATA');
  perform pg_temp.expect_error(format('select public.reorder_categories(%L, %L)',
    restaurant, array[categories[1], categories[1], categories[2], categories[3]]), 'STALE_DATA');
  perform pg_temp.expect_error(format('select public.reorder_categories(%L, %L)',
    restaurant, array[categories[1], categories[2], foreign_category]), 'STALE_DATA');

  -- ---------- save_modifier_group ----------
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_error(format(
    'select public.save_modifier_group(p_restaurant_id => %L, p_name => %L, p_min_select => 0, '
      || 'p_max_select => 1, p_is_available => true, p_options => %L)',
    restaurant, 'Salsas', '[{"name": "Ketchup", "price_delta": 0, "is_available": true}]'), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  -- La segunda opción falla después de insertar el grupo: no debe quedar nada.
  select count(*) into group_count from public.modifier_groups g where g.restaurant_id = restaurant;
  perform pg_temp.expect_error(format(
    'select public.save_modifier_group(p_restaurant_id => %L, p_name => %L, p_min_select => 0, '
      || 'p_max_select => 1, p_is_available => true, p_options => %L)',
    restaurant, 'Salsas', '[{"name": "Ketchup", "price_delta": 0, "is_available": true},
      {"name": "Mayo", "price_delta": "gratis", "is_available": true}]'),
    'invalid input syntax for type numeric%');
  if (select count(*) from public.modifier_groups g where g.restaurant_id = restaurant) <> group_count then
    raise exception 'A failed group save left a group behind';
  end if;

  modifier_group := public.save_modifier_group(p_restaurant_id => restaurant, p_name => 'Salsas',
    p_min_select => 0, p_max_select => 2, p_is_available => true,
    p_options => '[{"name": "Ketchup", "price_delta": 0, "is_available": true},
      {"name": "Cheddar", "price_delta": 1.5, "is_available": true}]');
  if (select array_agg(o.name order by o.sort_order) from public.modifier_options o where o.group_id = modifier_group)
      is distinct from array['Ketchup', 'Cheddar'] then
    raise exception 'Group options must be created in list order';
  end if;
  select o.id into kept_option from public.modifier_options o
    where o.group_id = modifier_group and o.name = 'Cheddar';

  -- Quita Ketchup, edita Cheddar (conserva su id) y agrega Barbacoa al final.
  saved := public.save_modifier_group(p_restaurant_id => restaurant, p_group_id => modifier_group,
    p_name => 'Salsas y extras', p_min_select => 1, p_max_select => 2, p_is_available => true,
    p_options => jsonb_build_array(
      jsonb_build_object('id', kept_option, 'name', 'Cheddar doble', 'price_delta', 2, 'is_available', false),
      jsonb_build_object('name', 'Barbacoa', 'price_delta', 0, 'is_available', true)));
  if saved <> modifier_group
    or (select array_agg(o.name order by o.sort_order) from public.modifier_options o where o.group_id = modifier_group)
      is distinct from array['Cheddar doble', 'Barbacoa']
    or not exists (select 1 from public.modifier_options o where o.id = kept_option
      and o.price_delta = 2 and not o.is_available and o.sort_order = 0)
    or not exists (select 1 from public.modifier_groups g where g.id = modifier_group
      and g.name = 'Salsas y extras' and g.min_select = 1) then
    raise exception 'Group update must replace its options';
  end if;

  perform pg_temp.expect_error(format(
    'select public.save_modifier_group(p_restaurant_id => %L, p_group_id => %L, p_name => %L, '
      || 'p_min_select => 0, p_max_select => 1, p_is_available => true, p_options => %L)',
    restaurant, modifier_group, 'Hijacked', jsonb_build_array(jsonb_build_object(
      'id', foreign_option, 'name', 'Hijacked', 'price_delta', 0, 'is_available', true))), 'STALE_DATA');
  perform pg_temp.expect_error(format(
    'select public.save_modifier_group(p_restaurant_id => %L, p_group_id => %L, p_name => %L, '
      || 'p_min_select => 0, p_max_select => 1, p_is_available => true, p_options => %L)',
    restaurant, foreign_group, 'Hijacked', '[{"name": "Hijacked", "price_delta": 0, "is_available": true}]'),
    'STALE_DATA');
  if exists (select 1 from public.modifier_groups g where g.name = 'Hijacked')
    or exists (select 1 from public.modifier_options o where o.name = 'Hijacked') then
    raise exception 'Stale group saves must not modify any row';
  end if;

  -- ---------- save_product ----------
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, categories[1], '[]', '{}'), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  -- El ingrediente falla después de insertar el producto: reintentar no puede duplicarlo.
  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, categories[1],
    '[{"name": "Pan", "is_removable": "tal vez", "is_available": true}]', '{}'),
    'invalid input syntax for type boolean%');
  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, foreign_category, '[]', '{}'), 'STALE_DATA');
  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, categories[1], '[]', array[foreign_group]),
    'STALE_DATA');
  if exists (select 1 from public.products p where p.restaurant_id = restaurant) then
    raise exception 'A failed product save left a product behind';
  end if;

  product := public.save_product(p_restaurant_id => restaurant, p_category_id => categories[1],
    p_name => ' Hamburguesa ', p_base_price => 10, p_dietary_tags => array['picante'],
    p_is_available => true, p_media_urls => array['https://example.com/a.jpg'], p_description => '  ',
    p_ingredients => '[{"name": "Pan", "is_removable": false, "is_available": true},
      {"name": "Cebolla", "is_removable": true, "is_available": true}]',
    p_group_ids => array[modifier_group]);
  if not exists (select 1 from public.products p where p.id = product and p.name = 'Hamburguesa'
      and p.description is null and p.dietary_tags = array['picante']
      and p.media_urls = array['https://example.com/a.jpg'])
    or (select array_agg(i.name order by i.sort_order) from public.product_ingredients i where i.product_id = product)
      is distinct from array['Pan', 'Cebolla']
    or not exists (select 1 from public.product_modifier_groups pg
      where pg.product_id = product and pg.group_id = modifier_group) then
    raise exception 'save_product must create the product with ingredients and groups';
  end if;
  select i.id into kept_ingredient from public.product_ingredients i
    where i.product_id = product and i.name = 'Cebolla';

  -- Quita Pan, agrega Tomate primero, edita Cebolla y desasigna el grupo.
  saved := public.save_product(p_restaurant_id => restaurant, p_product_id => product,
    p_category_id => categories[2], p_name => 'Hamburguesa doble', p_base_price => 12,
    p_dietary_tags => '{}', p_is_available => false, p_media_urls => '{}',
    p_ingredients => jsonb_build_array(
      jsonb_build_object('name', 'Tomate', 'is_removable', true, 'is_available', true),
      jsonb_build_object('id', kept_ingredient, 'name', 'Cebolla morada', 'is_removable', true, 'is_available', false)),
    p_group_ids => '{}');
  if saved <> product
    or not exists (select 1 from public.products p where p.id = product and p.name = 'Hamburguesa doble'
      and p.category_id = categories[2] and p.base_price = 12 and not p.is_available)
    or (select array_agg(i.name order by i.sort_order) from public.product_ingredients i where i.product_id = product)
      is distinct from array['Tomate', 'Cebolla morada']
    or not exists (select 1 from public.product_ingredients i where i.id = kept_ingredient and not i.is_available)
    or exists (select 1 from public.product_modifier_groups pg where pg.product_id = product) then
    raise exception 'Product update must replace ingredients and group assignments';
  end if;

  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, categories[1],
    jsonb_build_array(jsonb_build_object('id', foreign_ingredient, 'name', 'Hijacked',
      'is_removable', true, 'is_available', true)), '{}', product), 'STALE_DATA');
  perform pg_temp.expect_error(pg_temp.save_product_sql(restaurant, categories[1], '[]', '{}', foreign_product),
    'STALE_DATA');
  if exists (select 1 from public.product_ingredients i where i.name = 'Hijacked')
    or (select p.name from public.products p where p.id = product) <> 'Hamburguesa doble'
    or (select p.name from public.products p where p.id = foreign_product) <> 'Foreign dish' then
    raise exception 'Stale product saves must not modify any row';
  end if;

  raise notice 'Admin SQL assertions passed (onboarding, category order, groups, products, atomicity, stale data)';
end;
$$;

rollback;

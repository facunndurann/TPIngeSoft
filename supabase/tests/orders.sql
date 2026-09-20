-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_submit_error(
  sid uuid, rid uuid, items jsonb, amount numeric, notes text, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.submit_order(sid, rid, items, amount, notes);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  uid uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  table_id uuid;
  sid uuid;
  participant uuid;
  category uuid;
  product uuid;
  ingredient uuid;
  modifier_group uuid;
  choice uuid;
  choice_two uuid;
  request_id uuid := gen_random_uuid();
  v_order_id uuid;
  legacy_order_id uuid;
  saved public.orders;
  items jsonb;
  changed jsonb;
  bill record;
begin
  insert into auth.users(id, aud, role) values(uid, 'authenticated', 'authenticated');
  insert into auth.users(id, aud, role) values(outsider, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('Order SQL test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant, 'Branch') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Table')
    returning id into table_id;
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, table_id)
    returning id into sid;
  insert into public.session_participants(session_id, user_id, display_name) values(sid, uid, 'Customer')
    returning id into participant;
  insert into public.menu_categories(restaurant_id, name) values(restaurant, 'Category')
    returning id into category;
  insert into public.products(restaurant_id, category_id, name, base_price)
    values(restaurant, category, 'Original dish', 10.50) returning id into product;
  insert into public.product_ingredients(restaurant_id, product_id, name, is_removable)
    values(restaurant, product, 'Onion', true) returning id into ingredient;
  insert into public.modifier_groups(restaurant_id, name, min_select, max_select)
    values(restaurant, 'Original group', 1, 1) returning id into modifier_group;
  insert into public.product_modifier_groups(restaurant_id, product_id, group_id)
    values(restaurant, product, modifier_group);
  insert into public.modifier_options(restaurant_id, group_id, name, price_delta)
    values(restaurant, modifier_group, 'Original choice', 1.25) returning id into choice;
  insert into public.modifier_options(restaurant_id, group_id, name, price_delta)
    values(restaurant, modifier_group, 'Second choice', 2) returning id into choice_two;
  items := jsonb_build_array(jsonb_build_object(
    'productId', product, 'quantity', 2, 'optionIds', jsonb_build_array(choice),
    'removedIds', jsonb_build_array(ingredient), 'isShared', true
  ));

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'NOT_PARTICIPANT');
  perform set_config('request.jwt.claim.sub', uid::text, true);

  perform pg_temp.expect_submit_error(sid, request_id, null, 23.50, null, 'INVALID_ITEMS');
  perform pg_temp.expect_submit_error(sid, request_id, '{}'::jsonb, 23.50, null, 'INVALID_ITEMS');
  perform pg_temp.expect_submit_error(sid, request_id, '[]'::jsonb, 23.50, null, 'INVALID_ITEMS');
  perform pg_temp.expect_submit_error(sid, request_id, '[null]'::jsonb, 23.50, null, 'INVALID_ITEMS');
  perform pg_temp.expect_submit_error(sid, request_id, items, 'NaN'::numeric, null, 'INVALID_REQUEST');
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.505, null, 'INVALID_REQUEST');
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, repeat('x', 501), 'INVALID_REQUEST');
  changed := jsonb_set(items, '{0,quantity}', '1.5'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,quantity}', '100'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,isShared}', 'null'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,basePrice}', '0'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,optionIds}', jsonb_build_array(choice, upper(choice::text)));
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,removedIds}', jsonb_build_array(ingredient, upper(ingredient::text)));
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_ITEMS');
  changed := jsonb_set(items, '{0,optionIds}', jsonb_build_array(choice, choice_two));
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_MODIFIERS');
  changed := jsonb_set(items, '{0,optionIds}', '[]'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_MODIFIERS');
  changed := jsonb_set(items, '{0,optionIds}', jsonb_build_array(gen_random_uuid()));
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_MODIFIERS');
  changed := jsonb_set(items, '{0,removedIds}', jsonb_build_array(gen_random_uuid()));
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'INVALID_INGREDIENTS');

  update public.product_ingredients set is_available = false where id = ingredient;
  changed := jsonb_set(items, '{0,removedIds}', '[]'::jsonb);
  perform pg_temp.expect_submit_error(sid, request_id, changed, 23.50, null, 'PRODUCT_UNAVAILABLE');
  update public.modifier_groups set is_available = false where id = modifier_group;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'INVALID_MODIFIERS');
  update public.modifier_groups set is_available = true where id = modifier_group;
  update public.modifier_options set is_available = false where id = choice;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'INVALID_MODIFIERS');
  update public.modifier_options set is_available = true where id = choice;
  update public.menu_categories set is_active = false where id = category;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'PRODUCT_UNAVAILABLE');
  update public.menu_categories set is_active = true where id = category;
  update public.tables set is_active = false where id = table_id;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'TABLE_UNAVAILABLE');
  update public.tables set is_active = true where id = table_id;
  -- Un POS que no puede recibir el pedido revierte el envío completo; el mismo requestId
  -- se usa más abajo para confirmar que el reintento posterior funciona.
  insert into public.pos_integrations(restaurant_id, type, is_active) values(restaurant, 'internal', false);
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'POS_UNAVAILABLE');
  update public.pos_integrations set type = 'fudo', is_active = true where restaurant_id = restaurant;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'POS_UNSUPPORTED');
  delete from public.pos_integrations where restaurant_id = restaurant;
  perform pg_temp.expect_submit_error(sid, request_id, items, 0, null, 'PRICE_CHANGED');
  if exists(select 1 from public.orders where session_id = sid) then
    raise exception 'Invalid requests left partial orders';
  end if;

  saved := public.submit_order(sid, request_id, items, 23.50, 'Kitchen note');
  v_order_id := saved.id;
  if saved.status <> 'accepted' or saved.total_amount <> 23.50 or saved.accepted_at is null then
    raise exception 'submit_order must return the order accepted by the internal POS';
  end if;
  if not exists(select 1 from public.order_items oi where oi.order_id = v_order_id
    and oi.product_name = 'Original dish' and oi.quantity = 2 and oi.is_shared
    and oi.base_price = 10.50 and oi.total_price = 23.50 and oi.participant_id = participant) then
    raise exception 'Missing authoritative line snapshot';
  end if;
  if not exists(select 1 from public.order_item_modifiers om
    join public.order_items oi on oi.id = om.order_item_id
    where oi.order_id = v_order_id and om.option_name = 'Original choice'
      and om.group_name = 'Original group' and om.price_delta = 1.25) then
    raise exception 'Missing modifier snapshot';
  end if;
  if (select count(*) from public.integration_logs l where l.order_id = v_order_id
    and event = 'pos.internal.accepted') <> 1 then raise exception 'Missing internal POS acceptance log'; end if;
  select * into bill from public.session_bills where session_id = sid;
  if bill.submitted_amount <> 0 or bill.total_amount <> 23.50 or bill.pending_amount <> 23.50
    or bill.paid_amount <> 0 or bill.is_settled then raise exception 'Incorrect accepted bill'; end if;

  -- Pedidos 'submitted' anteriores a este flujo: la cuenta los separa y
  -- dispatch_internal_order (vía transition_order) los acepta una sola vez.
  insert into public.orders(restaurant_id, session_id, submitted_by, total_amount)
    values(restaurant, sid, participant, 4) returning id into legacy_order_id;
  select * into bill from public.session_bills where session_id = sid;
  if bill.submitted_amount <> 4 or bill.total_amount <> 23.50 then raise exception 'Incorrect submitted bill'; end if;
  perform public.dispatch_internal_order(legacy_order_id);
  perform public.dispatch_internal_order(legacy_order_id);
  if (select count(*) from public.integration_logs l where l.order_id = legacy_order_id
    and event = 'pos.internal.accepted') <> 1 then raise exception 'Duplicate dispatch'; end if;
  update public.orders set status = 'cancelled' where id = legacy_order_id;

  insert into public.payments(restaurant_id, session_id, participant_id, amount, mode, method, status)
    values(restaurant, sid, participant, 3.50, 'custom', 'external', 'approved'),
      (restaurant, sid, participant, 20, 'custom', 'mobile', 'pending');
  select * into bill from public.session_bills where session_id = sid;
  if bill.paid_amount <> 3.50 or bill.pending_amount <> 20 or bill.is_settled then
    raise exception 'Unapproved payments incorrectly credited'; end if;
  update public.payments set status = 'approved' where session_id = sid;
  select * into bill from public.session_bills where session_id = sid;
  if bill.paid_amount <> 23.50 or bill.pending_amount <> 0 or not bill.is_settled then
    raise exception 'Settled bill incorrect'; end if;
  if (select status from public.table_sessions where id = sid) <> 'open' then
    raise exception 'Phase 4 must not auto-close session'; end if;

  update public.products set name = 'Changed', base_price = 99, is_available = false where id = product;
  update public.modifier_options set name = 'Changed choice', price_delta = 5 where id = choice;
  update public.table_sessions set status = 'closed', closed_at = now() where id = sid;
  if (public.submit_order(sid, request_id, items, 23.50, 'Kitchen note')).id <> v_order_id then
    raise exception 'Replay failed after menu change and closure'; end if;
  perform pg_temp.expect_submit_error(sid, request_id, items, 23.50, null, 'IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_submit_error(sid, gen_random_uuid(), items, 23.50, null, 'SESSION_CLOSED');
  if not exists(select 1 from public.order_items oi where oi.order_id = v_order_id
    and oi.product_name = 'Original dish' and oi.base_price = 10.50 and oi.total_price = 23.50) then
    raise exception 'Historical snapshot was altered'; end if;

  if has_table_privilege('authenticated', 'public.orders', 'UPDATE')
    or has_table_privilege('authenticated', 'public.order_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.payments', 'UPDATE') then
    raise exception 'Authenticated role can bypass order/payment RPCs'; end if;
  raise notice 'Order SQL assertions passed (validation, atomicity, snapshots, idempotency, dispatch and bills)';
end;
$$;

rollback;

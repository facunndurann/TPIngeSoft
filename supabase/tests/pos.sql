-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_close_error(sid uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.close_table_session(sid);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  staff uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  other_staff uuid := gen_random_uuid();
  restaurant uuid;
  other_restaurant uuid;
  branch uuid;
  other_branch uuid;
  dining_table uuid;
  other_table uuid;
  sid uuid;
  other_sid uuid;
  participant uuid;
  category uuid;
  product uuid;
  v_order_id uuid;
  items jsonb;
  closed_id uuid;
  log_count integer;
begin
  insert into auth.users(id, aud, role) values
    (staff, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated'),
    (outsider, 'authenticated', 'authenticated'),
    (other_staff, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('POS SQL test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('POS other', gen_random_uuid()::text)
    returning id into other_restaurant;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, staff, 'owner'), (other_restaurant, other_staff, 'owner');
  insert into public.branches(restaurant_id, name) values(restaurant, 'Branch') returning id into branch;
  insert into public.branches(restaurant_id, name) values(other_restaurant, 'Other') returning id into other_branch;
  insert into public.profiles(id,username_normalized,full_name)
    values(staff,replace(staff::text,'-',''),'POS test operator');
  insert into public.branch_memberships(membership_id,restaurant_id,branch_id)
    select id,restaurant,branch from public.restaurant_members where user_id=staff and restaurant_id=restaurant;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Table')
    returning id into dining_table;
  insert into public.tables(restaurant_id, branch_id, label) values(other_restaurant, other_branch, 'Other table')
    returning id into other_table;
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table) returning id into sid;
  insert into public.table_sessions(restaurant_id, table_id) values(other_restaurant, other_table)
    returning id into other_sid;
  insert into public.session_participants(session_id, user_id, display_name) values(sid, diner, 'Diner')
    returning id into participant;
  insert into public.menu_categories(restaurant_id, name) values(restaurant, 'Category') returning id into category;
  insert into public.products(restaurant_id, category_id, name, base_price)
    values(restaurant, category, 'Dish', 10) returning id into product;
  items := jsonb_build_array(jsonb_build_object(
    'productId', product, 'quantity', 1, 'optionIds', '[]'::jsonb,
    'removedIds', '[]'::jsonb, 'isShared', false
  ));

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_close_error(sid, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_close_error(sid, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_staff::text, true);
  perform pg_temp.expect_close_error(sid, 'FORBIDDEN');
  perform pg_temp.expect_close_error(gen_random_uuid(), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform pg_temp.expect_close_error(null, 'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', diner::text, true);
  v_order_id := public.submit_order(sid, gen_random_uuid(), items, 10, null);
  perform public.dispatch_internal_order(v_order_id);

  perform set_config('request.jwt.claim.sub', staff::text, true);
  closed_id := public.close_table_session(sid);
  if closed_id <> sid then raise exception 'Close returned a different session'; end if;
  if (select status from public.table_sessions where id = sid) <> 'closed' then
    raise exception 'Session was not closed'; end if;
  if (select closed_at from public.table_sessions where id = sid) is null then
    raise exception 'closed_at was not recorded'; end if;
  select count(*) into log_count from public.integration_logs
    where restaurant_id = restaurant and event = 'session.closed'
      and payload->>'sessionId' = sid::text;
  if log_count <> 1 then raise exception 'Missing session.closed log'; end if;

  -- Idempotent retry does not duplicate the log or reopen the table.
  if public.close_table_session(sid) <> sid then raise exception 'Idempotent close failed'; end if;
  select count(*) into log_count from public.integration_logs
    where restaurant_id = restaurant and event = 'session.closed'
      and payload->>'sessionId' = sid::text;
  if log_count <> 1 then raise exception 'Idempotent close duplicated the log'; end if;

  if (select status from public.orders where id = v_order_id) <> 'accepted' then
    raise exception 'Closing a session must not alter kitchen tickets'; end if;

  -- A new open session can start on the same table after close.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if public.join_table_session((select t.qr_token from public.tables t where t.id = dining_table), 'Diner') = sid then
    raise exception 'QR join reused the closed session'; end if;
  if (select count(*) from public.table_sessions s where s.table_id = dining_table and s.status = 'open') <> 1 then
    raise exception 'Table cannot host a new open session after close'; end if;

  if has_table_privilege('authenticated', 'public.table_sessions', 'INSERT')
    or has_table_privilege('authenticated', 'public.table_sessions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.table_sessions', 'DELETE') then
    raise exception 'Authenticated role can bypass close_table_session'; end if;

  raise notice 'POS SQL assertions passed (auth, isolation, idempotent close, lock reuse, privileges)';
end;
$$;

rollback;

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

create function pg_temp.expect_move_error(sid uuid, src uuid, dest uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_move_table_session(sid, src, dest);
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
  destination uuid;
  occupied uuid;
  second_branch uuid;
  cross_branch_table uuid;
  section uuid;
  before_session jsonb;
  before_order jsonb;
  before_bill jsonb;
  before_payments jsonb;
  before_items jsonb;
  open_row public.pos_open_sessions;
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
  v_order_id := (public.submit_order(sid, gen_random_uuid(), items, 10, null)).id;

  -- local_date es el día del restaurante (UTC-3): el día cambia a las 03:00 UTC.
  update public.orders set created_at = '2026-09-06 02:59:59+00' where id = v_order_id;
  if (select local_date from public.orders where id = v_order_id) <> date '2026-09-05' then
    raise exception 'local_date must use the restaurant day, not the UTC day'; end if;
  update public.orders set created_at = '2026-09-06 03:00:00+00' where id = v_order_id;
  if (select local_date from public.orders where id = v_order_id) <> date '2026-09-06' then
    raise exception 'local_date must change at restaurant midnight'; end if;

  -- pos_open_sessions arma la tarjeta de mesa activa en una lectura, con el RLS
  -- de quien consulta (security_invoker): el personal ve sus mesas y nada más.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', staff::text, true);
  select * into open_row from public.pos_open_sessions where id = sid;
  if open_row.id is null
    or open_row.table_label <> 'Table' or open_row.branch_name <> 'Branch'
    or open_row.participant_names <> array['Diner']
    or open_row.submitted_amount <> 0 or open_row.total_amount <> 10
    or open_row.paid_amount <> 0 or open_row.pending_amount <> 10
    or open_row.kitchen_tickets <> 1 then
    raise exception 'Unexpected pos_open_sessions row: %', to_jsonb(open_row); end if;
  if exists (select 1 from public.pos_open_sessions where id = other_sid) then
    raise exception 'pos_open_sessions leaked another restaurant session'; end if;
  perform set_config('request.jwt.claim.sub', other_staff::text, true);
  if exists (select 1 from public.pos_open_sessions where id = sid) then
    raise exception 'Other restaurant staff can read pos_open_sessions'; end if;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claim.sub', staff::text, true);
  -- MI-65: traslado, integridad y rollback ante errores.
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Destino')
    returning id into destination;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Ocupada')
    returning id into occupied;
  perform public.pos_open_table_session(occupied);
  insert into public.branches(restaurant_id, name) values(restaurant, 'Otra sucursal')
    returning id into second_branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, second_branch, 'Otra')
    returning id into cross_branch_table;
  insert into public.floor_sections(restaurant_id, branch_id, name)
    values(restaurant, branch, 'Destino sector') returning id into section;
  update public.tables set section_id = section where id = destination;
  update public.table_sessions set split_type = 'percentages',
    split_allocations = jsonb_build_object(participant::text, 100), assigned_user_id = staff,
    bill_requested_at = now() where id = sid;
  insert into public.payments(restaurant_id, session_id, participant_id, amount, mode, status)
    values(restaurant, sid, participant, 3, 'custom', 'approved'),
          (restaurant, sid, participant, 2, 'custom', 'pending');
  select jsonb_agg(to_jsonb(p) order by id) into before_payments from public.payments p where session_id = sid;
  select jsonb_agg(to_jsonb(i) order by id) into before_items from public.order_items i where order_id = v_order_id;
  select to_jsonb(s) - 'table_id' into before_session from public.table_sessions s where id = sid;
  select to_jsonb(o) into before_order from public.orders o where id = v_order_id;
  select to_jsonb(b) into before_bill from public.session_bills b where session_id = sid;

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_staff::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, other_table, 'FORBIDDEN');
  perform pg_temp.expect_move_error(sid, dining_table, cross_branch_table, 'TABLE_BRANCH_MISMATCH');
  perform pg_temp.expect_move_error(sid, dining_table, occupied, 'TABLE_OCCUPIED');
  perform pg_temp.expect_move_error(sid, dining_table, dining_table, 'INVALID_REQUEST');
  perform pg_temp.expect_move_error(null, dining_table, destination, 'INVALID_REQUEST');
  perform pg_temp.expect_move_error(gen_random_uuid(), dining_table, destination, 'SESSION_NOT_FOUND');
  perform pg_temp.expect_move_error(sid, dining_table, gen_random_uuid(), 'TABLE_NOT_FOUND');
  update public.tables set is_visible = false where id = destination;
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'TABLE_UNAVAILABLE');
  update public.tables set is_visible = true, is_active = false where id = destination;
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'TABLE_UNAVAILABLE');
  update public.tables set is_active = true where id = destination;
  update public.floor_sections set is_active = false where id = section;
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'TABLE_UNAVAILABLE');
  update public.floor_sections set is_active = true where id = section;
  update public.branches set is_active = false where id = branch;
  -- Una sucursal dada de baja ya no otorga permiso: corta por alcance, no por mesa.
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'FORBIDDEN');
  update public.branches set is_active = true where id = branch;
  update public.restaurant_members set is_active = false where user_id = staff and restaurant_id = restaurant;
  perform pg_temp.expect_move_error(sid, dining_table, destination, 'FORBIDDEN');
  update public.restaurant_members set is_active = true where user_id = staff and restaurant_id = restaurant;
  if (select table_id from public.table_sessions where id = sid) <> dining_table
    or exists (select 1 from public.pos_audit_log where session_id = sid and action = 'session.moved') then
    raise exception 'Rejected move changed the session or audit'; end if;

  if public.pos_move_table_session(sid, dining_table, destination) <> sid then
    raise exception 'Move returned another session'; end if;
  if (select table_id from public.table_sessions where id = sid) <> destination
    or exists (select 1 from public.table_sessions where table_id = dining_table and status = 'open') then
    raise exception 'Move did not free the source and occupy the destination'; end if;
  if (select to_jsonb(s) - 'table_id' from public.table_sessions s where id = sid) <> before_session
    or (select to_jsonb(o) from public.orders o where id = v_order_id) <> before_order
    or (select to_jsonb(b) from public.session_bills b where session_id = sid) <> before_bill
    or (select jsonb_agg(to_jsonb(p) order by id) from public.payments p where session_id = sid) <> before_payments
    or (select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id = v_order_id) <> before_items
    or not exists (select 1 from public.session_participants where id = participant and session_id = sid) then
    raise exception 'Move changed session data, orders, participants or bill'; end if;
  if (select count(*) from public.pos_audit_log where session_id = sid and action = 'session.moved'
    and actor_user_id = staff and branch_id = branch and created_at is not null
    and details->>'sourceTableId' = dining_table::text
    and details->>'destinationTableId' = destination::text) <> 1 then
    raise exception 'Missing move audit'; end if;
  perform pg_temp.expect_move_error(sid, dining_table, occupied, 'SESSION_MOVE_CONFLICT');
  -- El QR destino continúa la misma cuenta y sus pedidos.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if public.join_table_session((select qr_token from public.tables where id = destination), 'Diner') <> sid then
    raise exception 'Destination QR did not join moved session'; end if;
  perform set_config('request.jwt.claim.sub', staff::text, true);
  if has_function_privilege('anon', 'public.pos_move_table_session(uuid,uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.pos_move_table_session(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Wrong move privileges'; end if;

  closed_id := public.close_table_session(sid);
  if closed_id <> sid then raise exception 'Close returned a different session'; end if;
  if (select status from public.table_sessions where id = sid) <> 'closed' then
    raise exception 'Session was not closed'; end if;
  if (select closed_at from public.table_sessions where id = sid) is null then
    raise exception 'closed_at was not recorded'; end if;
  if exists (select 1 from public.pos_open_sessions where id = sid) then
    raise exception 'A closed session is still listed as active'; end if;
  select count(*) into log_count from public.integration_logs
    where restaurant_id = restaurant and event = 'session.closed'
      and payload->>'sessionId' = sid::text;
  if log_count <> 1 then raise exception 'Missing session.closed log'; end if;

  perform pg_temp.expect_move_error(sid, destination, dining_table, 'SESSION_MOVE_CONFLICT');

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

  raise notice 'POS SQL assertions passed (auth, isolation, local date, open sessions view, idempotent close, lock reuse, privileges, move integrity, move conflicts, move audit)';
end;
$$;

rollback;

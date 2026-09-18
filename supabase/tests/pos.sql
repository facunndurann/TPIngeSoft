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

create function pg_temp.expect_move_error(sid uuid, src uuid, dest uuid, eid uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_move_table_session(sid, src, dest, eid);
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
  employee uuid;
  before_session jsonb;
  before_order jsonb;
  before_bill jsonb;
  before_payments jsonb;
  before_items jsonb;
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
  perform pg_temp.expect_close_error(gen_random_uuid(), 'SESSION_NOT_FOUND');
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform pg_temp.expect_close_error(null, 'INVALID_REQUEST');

  perform set_config('request.jwt.claim.sub', diner::text, true);
  v_order_id := public.submit_order(sid, gen_random_uuid(), items, 10, null);
  perform public.dispatch_internal_order(v_order_id);

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
  insert into public.pos_employees(restaurant_id, full_name, pin_hash)
    values(restaurant, 'Operador', 'unused') returning id into employee;
  update public.table_sessions set split_type = 'percentages',
    split_allocations = jsonb_build_object(participant::text, 100), assigned_employee_id = employee,
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
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_staff::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform pg_temp.expect_move_error(sid, dining_table, other_table, employee, 'FORBIDDEN');
  perform pg_temp.expect_move_error(sid, dining_table, cross_branch_table, employee, 'TABLE_BRANCH_MISMATCH');
  perform pg_temp.expect_move_error(sid, dining_table, occupied, employee, 'TABLE_OCCUPIED');
  perform pg_temp.expect_move_error(sid, dining_table, dining_table, employee, 'INVALID_REQUEST');
  perform pg_temp.expect_move_error(null, dining_table, destination, employee, 'INVALID_REQUEST');
  perform pg_temp.expect_move_error(gen_random_uuid(), dining_table, destination, employee, 'SESSION_NOT_FOUND');
  perform pg_temp.expect_move_error(sid, dining_table, gen_random_uuid(), employee, 'TABLE_NOT_FOUND');
  update public.tables set is_visible = false where id = destination;
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'TABLE_UNAVAILABLE');
  update public.tables set is_visible = true, is_active = false where id = destination;
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'TABLE_UNAVAILABLE');
  update public.tables set is_active = true where id = destination;
  update public.floor_sections set is_active = false where id = section;
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'TABLE_UNAVAILABLE');
  update public.floor_sections set is_active = true where id = section;
  update public.branches set is_active = false where id = branch;
  perform pg_temp.expect_move_error(sid, dining_table, destination, employee, 'TABLE_UNAVAILABLE');
  update public.branches set is_active = true where id = branch;
  perform pg_temp.expect_move_error(sid, dining_table, destination, gen_random_uuid(), 'EMPLOYEE_NOT_FOUND');
  if (select table_id from public.table_sessions where id = sid) <> dining_table
    or exists (select 1 from public.pos_audit_log where session_id = sid and action = 'session.moved') then
    raise exception 'Rejected move changed the session or audit'; end if;

  if public.pos_move_table_session(sid, dining_table, destination, employee) <> sid then
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
    and user_id = staff and employee_id = employee and created_at is not null
    and details->>'sourceTableId' = dining_table::text
    and details->>'destinationTableId' = destination::text) <> 1 then
    raise exception 'Missing move audit'; end if;
  perform pg_temp.expect_move_error(sid, dining_table, occupied, employee, 'SESSION_MOVE_CONFLICT');
  -- El QR destino continúa la misma cuenta y sus pedidos.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if public.join_table_session((select qr_token from public.tables where id = destination), 'Diner') <> sid then
    raise exception 'Destination QR did not join moved session'; end if;
  perform set_config('request.jwt.claim.sub', staff::text, true);
  if has_function_privilege('anon', 'public.pos_move_table_session(uuid,uuid,uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.pos_move_table_session(uuid,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Wrong move privileges'; end if;

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

  perform pg_temp.expect_move_error(sid, destination, dining_table, employee, 'SESSION_MOVE_CONFLICT');

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

  raise notice 'POS SQL assertions passed (auth, isolation, idempotent close, lock reuse, privileges, move integrity, move conflicts, move audit)';
end;
$$;

rollback;

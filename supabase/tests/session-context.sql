-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Cuenta con o sin mesa y autoría del pedido (sprint 3, fase 2). Independiente
-- del seed; todo se revierte al final.
begin;

-- Error esperado de una sentencia: el código de negocio de un raise exception,
-- o el SQLSTATE de un constraint (23502 not null, 23503 FK, 23505 único, 23514 check).
create function pg_temp.expect_error(statement text, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    execute statement;
  exception when others then
    actual := case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
  end;
  if actual is distinct from expected then
    raise exception 'Expected % from %, got %', expected, statement, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  staff uuid := gen_random_uuid();         -- dueño con cuenta POS en la sucursal 1
  owner_admin uuid := gen_random_uuid();   -- dueño sin cuenta POS (panel admin)
  branch_two_staff uuid := gen_random_uuid(); -- supervisor solo de la sucursal 2
  other_staff uuid := gen_random_uuid();   -- dueño de otro restaurante
  buyer uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  reader uuid;
  restaurant uuid;
  other_restaurant uuid;
  branch uuid;
  branch_two uuid;
  other_branch uuid;
  dining_table uuid;
  second_table uuid;
  branch_two_table uuid;
  other_table uuid;
  category uuid;
  product uuid;
  items jsonb;
  takeout uuid;
  buyer_participant uuid;
  takeout_order public.orders;
  card public.pos_open_sessions;
  table_session uuid;
  diner_participant uuid;
  table_order public.orders;
  mobile record;
  pos_request uuid := gen_random_uuid();
begin
  insert into auth.users(id, aud, role) values
    (staff, 'authenticated', 'authenticated'),
    (owner_admin, 'authenticated', 'authenticated'),
    (branch_two_staff, 'authenticated', 'authenticated'),
    (other_staff, 'authenticated', 'authenticated'),
    (buyer, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated'),
    (stranger, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('Session context', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('Session other', gen_random_uuid()::text)
    returning id into other_restaurant;
  insert into public.branches(restaurant_id, name, payment_methods)
    values(restaurant, 'Mostrador', '{mobile,in_person,external}') returning id into branch;
  insert into public.branches(restaurant_id, name) values(restaurant, 'Segunda') returning id into branch_two;
  insert into public.branches(restaurant_id, name) values(other_restaurant, 'Ajena') returning id into other_branch;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, staff, 'owner'), (restaurant, owner_admin, 'owner'),
    (restaurant, branch_two_staff, 'supervisor'), (other_restaurant, other_staff, 'owner');
  insert into public.profiles(id, username_normalized, full_name) values
    (staff, replace(staff::text, '-', ''), 'Cajera Uno'),
    (branch_two_staff, replace(branch_two_staff::text, '-', ''), 'Supervisor Dos'),
    (other_staff, replace(other_staff::text, '-', ''), 'Ajeno');
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select id, restaurant, branch from public.restaurant_members where user_id = staff and restaurant_id = restaurant;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select id, restaurant, branch_two from public.restaurant_members where user_id = branch_two_staff;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select id, other_restaurant, other_branch from public.restaurant_members where user_id = other_staff;
  insert into public.tables(restaurant_id, branch_id, label, qr_token)
    values(restaurant, branch, 'Mesa 1', 'ctx-' || gen_random_uuid()) returning id into dining_table;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Mesa 2')
    returning id into second_table;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch_two, 'Mesa sucursal 2')
    returning id into branch_two_table;
  insert into public.tables(restaurant_id, branch_id, label) values(other_restaurant, other_branch, 'Mesa ajena')
    returning id into other_table;
  insert into public.menu_categories(restaurant_id, name) values(restaurant, 'Carta') returning id into category;
  insert into public.products(restaurant_id, category_id, name, base_price)
    values(restaurant, category, 'Plato', 10) returning id into product;
  items := jsonb_build_array(jsonb_build_object(
    'productId', product, 'quantity', 1, 'optionIds', '[]'::jsonb,
    'removedIds', '[]'::jsonb, 'isShared', false
  ));

  -- ------------------------------------------------------------
  -- La base impone la forma de la cuenta
  -- ------------------------------------------------------------
  perform pg_temp.expect_error(format(
    'insert into public.table_sessions(restaurant_id, branch_id, table_id, kind) values(%L, %L, %L, ''takeout'')',
    restaurant, branch, dining_table), '23514');
  perform pg_temp.expect_error(format(
    'insert into public.table_sessions(restaurant_id, branch_id) values(%L, %L)',
    restaurant, branch), '23514');
  perform pg_temp.expect_error(format(
    'insert into public.table_sessions(restaurant_id, kind) values(%L, ''takeout'')',
    restaurant), '23502');
  perform pg_temp.expect_error(format(
    'insert into public.table_sessions(restaurant_id, branch_id, kind) values(%L, %L, ''takeout'')',
    restaurant, other_branch), '23503');
  -- Una cuenta de mesa no puede declarar otra sucursal que la de su mesa.
  perform pg_temp.expect_error(format(
    'insert into public.table_sessions(restaurant_id, branch_id, table_id) values(%L, %L, %L)',
    restaurant, branch_two, dining_table), '23503');
  -- La mesa de una cuenta abierta no se muda de sucursal por debajo.
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, branch_two_table);
  perform pg_temp.expect_error(format(
    'update public.tables set branch_id = %L where id = %L', branch, branch_two_table), '23503');

  -- ------------------------------------------------------------
  -- Cuenta takeout: sin mesa, con sucursal, pedido por el motor común
  -- ------------------------------------------------------------
  insert into public.table_sessions(restaurant_id, branch_id, kind)
    values(restaurant, branch, 'takeout') returning id into takeout;
  insert into public.session_participants(session_id, user_id, display_name)
    values(takeout, buyer, 'Comprador') returning id into buyer_participant;

  perform set_config('request.jwt.claim.sub', buyer::text, true);
  takeout_order := public.submit_order(takeout, gen_random_uuid(), items, 10, null);
  if takeout_order.status <> 'accepted' or takeout_order.origin <> 'qr'
    or takeout_order.submitted_by <> buyer_participant or takeout_order.staff_author_id is not null then
    raise exception 'Takeout order without a table: %', to_jsonb(takeout_order); end if;
  -- Cobrar en persona sale de los medios de la sucursal de la cuenta.
  perform public.request_session_service(takeout, 'in_person_payment');

  -- ------------------------------------------------------------
  -- Lecturas: la sucursal de la cuenta decide quién la ve
  -- ------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', staff::text, true);
  if not exists (select 1 from public.orders where id = takeout_order.id)
    or not exists (select 1 from public.table_sessions where id = takeout)
    or not exists (select 1 from public.session_bills where session_id = takeout and total_amount = 10) then
    raise exception 'Branch staff must read the takeout account'; end if;
  select * into card from public.pos_open_sessions where id = takeout;
  if card.id is null or card.kind <> 'takeout' or card.table_id is not null
    or card.table_label is not null or card.branch_id <> branch or card.branch_name <> 'Mostrador'
    or card.participant_names <> array['Comprador'] or card.total_amount <> 10
    or card.kitchen_tickets <> 1 then
    raise exception 'Unexpected takeout card: %', to_jsonb(card); end if;

  perform set_config('request.jwt.claim.sub', owner_admin::text, true);
  if not exists (select 1 from public.orders where id = takeout_order.id) then
    raise exception 'The restaurant admin must read every branch account'; end if;

  foreach reader in array array[branch_two_staff, other_staff, diner, stranger] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    if exists (select 1 from public.orders where id = takeout_order.id)
      or exists (select 1 from public.table_sessions where id = takeout)
      or exists (select 1 from public.session_participants where session_id = takeout)
      or exists (select 1 from public.session_bills where session_id = takeout)
      or exists (select 1 from public.pos_open_sessions where id = takeout) then
      raise exception 'Takeout account leaked to %', reader; end if;
  end loop;
  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------
  -- Operaciones: permisos, pagos y cierre con la sucursal de la cuenta
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', branch_two_staff::text, true);
  perform pg_temp.expect_error(format(
    'select public.pos_transition_order(%L, ''in_preparation'')', takeout_order.id), 'FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.pos_record_payment(%L, 5, ''in_person'')', takeout), 'FORBIDDEN');
  perform pg_temp.expect_error(format('select public.pos_close_table_session(%L)', takeout), 'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform public.pos_transition_order(takeout_order.id, 'in_preparation');
  perform public.pos_resolve_session_request(takeout, 'in_person_payment');
  perform public.pos_record_payment(takeout, 5, 'in_person');
  -- Trasladar es de mesa a mesa: una cuenta sin mesa no coincide con ningún origen.
  perform pg_temp.expect_error(format(
    'select public.pos_move_table_session(%L, %L, %L)', takeout, dining_table, second_table),
    'SESSION_MOVE_CONFLICT');

  perform set_config('request.jwt.claim.sub', buyer::text, true);
  select * into mobile from public.create_mobile_payment(takeout, gen_random_uuid(), 'full');
  if mobile.amount <> 5 or mobile.status <> 'pending' then
    raise exception 'Mobile payment over the takeout balance: %', to_jsonb(mobile); end if;

  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform public.pos_close_table_session(takeout);
  if (select status from public.table_sessions where id = takeout) <> 'closed' then
    raise exception 'Branch staff must close a takeout account'; end if;
  if (select count(*) from public.pos_audit_log where session_id = takeout and branch_id = branch) <> 4 then
    raise exception 'Takeout operations must be audited in the account branch'; end if;

  -- ------------------------------------------------------------
  -- Cuenta de mesa: igual que antes, con la sucursal de su mesa
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', diner::text, true);
  table_session := public.join_table_session(
    (select qr_token from public.tables where id = dining_table), 'Comensal');
  if (select kind <> 'table' or branch_id <> branch or table_id <> dining_table
      from public.table_sessions where id = table_session) then
    raise exception 'A QR session must keep its table and take its branch'; end if;
  select id into diner_participant from public.session_participants
    where session_id = table_session and user_id = diner;
  table_order := public.submit_order(table_session, gen_random_uuid(), items, 10, null);

  -- ------------------------------------------------------------
  -- Autoría: nada de lo que opera la mesa la reescribe
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform public.pos_open_table_session(dining_table);
  perform public.pos_transition_order(table_order.id, 'in_preparation');
  perform public.pos_move_table_session(table_session, dining_table, second_table);
  perform public.pos_close_table_session(table_session);
  if (select assigned_user_id from public.table_sessions where id = table_session) <> staff then
    raise exception 'Operating the table must change the responsible'; end if;
  if (select origin <> 'qr' or submitted_by is distinct from diner_participant
      or staff_author_id is not null or staff_author_name is not null
      from public.orders where id = table_order.id) then
    raise exception 'Moving, closing or changing the responsible rewrote the author'; end if;

  perform pg_temp.expect_error(format(
    'update public.orders set origin = ''pos'', submitted_by = null, staff_author_id = %L, staff_author_name = ''Otro'' where id = %L',
    staff, table_order.id), 'ORDER_AUTHORSHIP_IMMUTABLE');
  perform pg_temp.expect_error(format(
    'update public.orders set submitted_by = %L where id = %L', buyer_participant, table_order.id),
    'ORDER_AUTHORSHIP_IMMUTABLE');
  -- Borrar al participante sí deja el autor como desconocido (on delete set null).
  delete from public.session_participants where id = diner_participant;
  if (select submitted_by from public.orders where id = table_order.id) is not null then
    raise exception 'Deleting the participant must leave an unknown author'; end if;

  -- ------------------------------------------------------------
  -- Origen y autor POS: forma e idempotencia por cuenta de personal
  -- ------------------------------------------------------------
  perform pg_temp.expect_error(format(
    'insert into public.orders(restaurant_id, session_id, origin, staff_author_id) values(%L, %L, ''pos'', %L)',
    restaurant, takeout, staff), '23514');
  perform pg_temp.expect_error(format(
    'insert into public.orders(restaurant_id, session_id, origin, submitted_by, staff_author_id, staff_author_name) values(%L, %L, ''pos'', %L, %L, ''Cajera Uno'')',
    restaurant, takeout, buyer_participant, staff), '23514');
  perform pg_temp.expect_error(format(
    'insert into public.orders(restaurant_id, session_id, submitted_by, staff_author_id) values(%L, %L, %L, %L)',
    restaurant, takeout, buyer_participant, staff), '23514');
  insert into public.orders(restaurant_id, session_id, origin, staff_author_id, staff_author_name, request_id)
    values(restaurant, takeout, 'pos', staff, 'Cajera Uno', pos_request);
  perform pg_temp.expect_error(format(
    'insert into public.orders(restaurant_id, session_id, origin, staff_author_id, staff_author_name, request_id) values(%L, %L, ''pos'', %L, ''Cajera Uno'', %L)',
    restaurant, takeout, staff, pos_request), '23505');
  insert into public.orders(restaurant_id, session_id, origin, staff_author_id, staff_author_name, request_id)
    values(restaurant, takeout, 'pos', branch_two_staff, 'Supervisor Dos', pos_request);

  raise notice 'Session context SQL assertions passed (account shape, takeout without table, branch-scoped reads, payments and closure, table compatibility, stable authorship, POS origin)';
end;
$$;

rollback;

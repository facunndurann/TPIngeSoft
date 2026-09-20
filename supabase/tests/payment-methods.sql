-- MI-48: cada sucursal decide con qué se le puede pagar, y esa decisión manda
-- también del lado del servidor: la app esconde el botón, pero el que no deja
-- pedir un cobro que el local no ofrece es Postgres.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_request_error(
  sid uuid, kind public.session_request_kind, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.request_session_service(sid, kind);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'request: expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  owner_user uuid := gen_random_uuid();
  waiter uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  dining_table uuid;
  sid uuid;
  saved public.payment_method[];
begin
  insert into auth.users(id, aud, role) values
    (owner_user, 'authenticated', 'authenticated'),
    (waiter, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('Payments test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant, 'Centro')
    returning id into branch;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, owner_user, 'owner'), (restaurant, waiter, 'waiter');
  insert into public.profiles(id, username_normalized, full_name)
    values(waiter, replace(waiter::text, '-', ''), 'Mozo');
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select id, restaurant, branch from public.restaurant_members where restaurant_id = restaurant;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Mesa 1')
    returning id into dining_table;
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, diner, 'Comensal');

  -- ---------- Default ----------
  -- Lo que un local puede honrar sin integrar ningún proveedor; `mobile` se
  -- prende a mano cuando hay con qué cobrarlo.
  select payment_methods into saved from public.branches where id = branch;
  if saved is distinct from '{in_person,external}'::public.payment_method[] then
    raise exception 'Unexpected default payment methods: %', saved; end if;

  -- ---------- Quién configura ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', waiter::text, true);
  -- El mozo opera el salón, no configura el local: RLS le deja la fila intacta.
  update public.branches set payment_methods = '{mobile}' where id = branch;
  perform set_config('request.jwt.claim.sub', diner::text, true);
  update public.branches set payment_methods = '{mobile}' where id = branch;
  perform set_config('role', 'postgres', true);
  if (select payment_methods from public.branches where id = branch)
     is distinct from '{in_person,external}'::public.payment_method[] then
    raise exception 'A non-admin changed the payment methods of the branch'; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  update public.branches set payment_methods = '{mobile,external}' where id = branch;
  -- El comensal lee la sucursal para abrir la carta: los medios le llegan ahí.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if (select payment_methods from public.branches where id = branch)
     is distinct from '{mobile,external}'::public.payment_method[] then
    raise exception 'The diner cannot read the payment methods of their branch'; end if;
  perform set_config('role', 'postgres', true);

  -- ---------- La regla vive en la base ----------
  perform set_config('request.jwt.claim.sub', diner::text, true);
  -- Sin `in_person` habilitado, pedir que venga un mozo a cobrar no es una opción.
  perform pg_temp.expect_request_error(sid, 'in_person_payment', 'PAYMENT_METHOD_DISABLED');
  -- Pedir la cuenta no es pagar: no depende de ningún medio.
  if public.request_session_service(sid, 'bill') is null then
    raise exception 'Asking for the bill must not depend on payment methods'; end if;
  if (select in_person_payment_requested_at from public.table_sessions where id = sid) is not null then
    raise exception 'A rejected request marked the table anyway'; end if;

  update public.branches set payment_methods = '{in_person}' where id = branch;
  if public.request_session_service(sid, 'in_person_payment') is null then
    raise exception 'Enabling the method did not allow asking for it'; end if;

  -- Un local sin medios habilitados es válido: solo se puede pedir la cuenta.
  update public.branches set payment_methods = '{}' where id = branch;
  update public.table_sessions set in_person_payment_requested_at = null where id = sid;
  perform pg_temp.expect_request_error(sid, 'in_person_payment', 'PAYMENT_METHOD_DISABLED');

  raise notice 'Payment method SQL assertions passed (default, admin-only writes, diner read, server-side rule)';
end;
$$;

rollback;

-- MI-38 / MI-46 / MI-47: pedir la cuenta o cobro presencial desde la mesa, y
-- atender esa solicitud desde el salón. Las dos RPCs validan en Postgres y usan
-- los códigos del catálogo compartido (packages/shared/src/errors.ts).
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

create function pg_temp.expect_resolve_error(
  sid uuid, kind public.session_request_kind, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_resolve_session_request(sid, kind);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'resolve: expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  diner uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  waiter uuid := gen_random_uuid();
  cook uuid := gen_random_uuid();
  other_waiter uuid := gen_random_uuid();
  restaurant uuid;
  other_restaurant uuid;
  branch uuid;
  other_branch uuid;
  dining_table uuid;
  other_table uuid;
  sid uuid;
  closed_sid uuid;
  other_sid uuid;
  asked timestamptz;
  again timestamptz;
  paid_ask timestamptz;
  attended timestamptz;
  saved public.table_sessions;
  card public.pos_open_sessions;
  audits integer;
begin
  insert into auth.users(id, aud, role) values
    (diner, 'authenticated', 'authenticated'),
    (outsider, 'authenticated', 'authenticated'),
    (waiter, 'authenticated', 'authenticated'),
    (cook, 'authenticated', 'authenticated'),
    (other_waiter, 'authenticated', 'authenticated');

  insert into public.restaurants(name, slug) values('Requests test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('Requests other', gen_random_uuid()::text)
    returning id into other_restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant, 'Centro')
    returning id into branch;
  insert into public.branches(restaurant_id, name) values(other_restaurant, 'Ajena')
    returning id into other_branch;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, waiter, 'waiter'), (restaurant, cook, 'kitchen'),
    (other_restaurant, other_waiter, 'waiter');
  insert into public.profiles(id, username_normalized, full_name) values
    (waiter, replace(waiter::text, '-', ''), 'Mozo'),
    (cook, replace(cook::text, '-', ''), 'Cocinero'),
    (other_waiter, replace(other_waiter::text, '-', ''), 'Mozo ajeno');
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select m.id, m.restaurant_id,
      case when m.restaurant_id = restaurant then branch else other_branch end
    from public.restaurant_members m where m.user_id in (waiter, cook, other_waiter);

  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Mesa 1')
    returning id into dining_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(other_restaurant, other_branch, 'Mesa ajena') returning id into other_table;
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.table_sessions(restaurant_id, table_id, status, closed_at)
    values(restaurant, dining_table, 'closed', now()) returning id into closed_sid;
  insert into public.table_sessions(restaurant_id, table_id) values(other_restaurant, other_table)
    returning id into other_sid;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, diner, 'Comensal');
  insert into public.session_participants(session_id, user_id, display_name)
    values(closed_sid, diner, 'Comensal');

  -- Atender el salón es del salón y de la caja, nunca de cocina.
  if not exists (select 1 from public.role_permissions
      where role = 'waiter' and permission = 'sessions.attend')
    or not exists (select 1 from public.role_permissions
      where role = 'cashier' and permission = 'sessions.attend')
    or exists (select 1 from public.role_permissions
      where role = 'kitchen' and permission = 'sessions.attend') then
    raise exception 'sessions.attend is granted to the wrong roles'; end if;

  -- ---------- Pedir: quién puede ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_request_error(sid, 'bill', 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', waiter::text, true);
  -- Un empleado atiende la mesa desde el POS; no pide la cuenta por el comensal.
  perform pg_temp.expect_request_error(sid, 'bill', 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_request_error(sid, 'bill', 'NOT_PARTICIPANT');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_request_error(null, 'bill', 'INVALID_REQUEST');
  perform pg_temp.expect_request_error(sid, null, 'INVALID_REQUEST');
  perform pg_temp.expect_request_error(gen_random_uuid(), 'bill', 'SESSION_NOT_FOUND');
  perform pg_temp.expect_request_error(closed_sid, 'bill', 'SESSION_CLOSED');

  select * into saved from public.table_sessions where id = sid;
  if saved.bill_requested_at is not null or saved.in_person_payment_requested_at is not null then
    raise exception 'Rejected requests left a mark on the session'; end if;

  -- ---------- Pedir: la cuenta ----------
  asked := public.request_session_service(sid, 'bill');
  select * into saved from public.table_sessions where id = sid;
  if saved.bill_requested_at is distinct from asked then
    raise exception 'The bill request was not stored'; end if;
  if saved.in_person_payment_requested_at is not null then
    raise exception 'Asking for the bill also asked for in-person payment'; end if;

  -- Insistir no crea otra solicitud: conserva la hora original, que es la que
  -- le dice al mozo hace cuánto esperan.
  again := public.request_session_service(sid, 'bill');
  if again is distinct from asked
    or (select bill_requested_at from public.table_sessions where id = sid) is distinct from asked then
    raise exception 'A repeated request moved the original timestamp'; end if;

  -- ---------- Pedir: cobro presencial ----------
  paid_ask := public.request_session_service(sid, 'in_person_payment');
  select * into saved from public.table_sessions where id = sid;
  if saved.in_person_payment_requested_at is distinct from paid_ask
    or saved.bill_requested_at is distinct from asked then
    raise exception 'The two requests are not independent'; end if;

  -- ---------- MI-47: el salón las ve ----------
  -- La vista se lee con el RLS de quien consulta: un mozo sin payments.read
  -- tiene que ver igual sus mesas activas y lo que pidieron.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', waiter::text, true);
  select * into card from public.pos_open_sessions where id = sid;
  if card.id is null then
    raise exception 'A waiter cannot see the active tables of their own branch'; end if;
  if card.bill_requested_at is distinct from asked
    or card.in_person_payment_requested_at is distinct from paid_ask then
    raise exception 'pos_open_sessions does not expose the requests'; end if;
  -- Un importe que no puede ver no es un «$ 0»: la pantalla lo oculta en vez de mostrarlo.
  if card.total_amount is not null or card.pending_amount is not null then
    raise exception 'Hidden amounts must read as null, not 0'; end if;
  if exists (select 1 from public.pos_open_sessions where id = other_sid) then
    raise exception 'pos_open_sessions leaked another restaurant session'; end if;
  perform set_config('role', 'postgres', true);

  -- ---------- Atender: quién puede ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_resolve_error(sid, 'bill', 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_resolve_error(sid, 'bill', 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', cook::text, true);
  perform pg_temp.expect_resolve_error(sid, 'bill', 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_waiter::text, true);
  perform pg_temp.expect_resolve_error(sid, 'bill', 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', waiter::text, true);
  perform pg_temp.expect_resolve_error(null, 'bill', 'INVALID_REQUEST');
  perform pg_temp.expect_resolve_error(sid, null, 'INVALID_REQUEST');
  -- Una sesión inexistente no se distingue de una ajena: primero autorización.
  perform pg_temp.expect_resolve_error(gen_random_uuid(), 'bill', 'FORBIDDEN');

  select * into saved from public.table_sessions where id = sid;
  if saved.bill_requested_at is distinct from asked
    or saved.in_person_payment_requested_at is distinct from paid_ask then
    raise exception 'A rejected attend cleared a live request'; end if;

  -- ---------- Atender ----------
  if public.pos_resolve_session_request(sid, 'bill') is distinct from asked then
    raise exception 'Attending did not return the time of the request it closed'; end if;
  select * into saved from public.table_sessions where id = sid;
  if saved.bill_requested_at is not null then
    raise exception 'The bill request was not cleared'; end if;
  if saved.in_person_payment_requested_at is distinct from paid_ask then
    raise exception 'Attending one request cleared the other'; end if;
  if saved.assigned_user_id is distinct from waiter then
    raise exception 'Attending did not leave the operator responsible for the table'; end if;
  -- Atender no es borrar: la mesa tiene que poder leer que ya la atendieron.
  if saved.bill_attended_at is null then
    raise exception 'Attending left the diner without confirmation'; end if;
  if saved.in_person_payment_attended_at is not null then
    raise exception 'Attending one request confirmed the other'; end if;
  attended := saved.bill_attended_at;

  select count(*) into audits from public.pos_audit_log
    where session_id = sid and action = 'session.request_attended'
      and details->>'kind' = 'bill';
  if audits <> 1 then raise exception 'Attending a request was not audited exactly once'; end if;

  -- Dos mozos tocando el mismo botón: el segundo no audita una atención de más.
  if public.pos_resolve_session_request(sid, 'bill') is not null then
    raise exception 'Attending an already attended request reported work'; end if;
  select count(*) into audits from public.pos_audit_log
    where session_id = sid and action = 'session.request_attended';
  if audits <> 1 then raise exception 'An idempotent attend duplicated the audit'; end if;
  if (select bill_attended_at from public.table_sessions where id = sid) is distinct from attended then
    raise exception 'An idempotent attend moved the confirmation the diner is reading'; end if;

  -- Cobrar no cierra la mesa: la cierra quien tiene sessions.close. Para que no
  -- quede colgada, lo atendido se ve en la misma lista donde está ese botón.
  perform public.pos_resolve_session_request(sid, 'in_person_payment');
  perform set_config('role', 'authenticated', true);
  select * into card from public.pos_open_sessions where id = sid;
  if card.id is null or (select status from public.table_sessions where id = sid) <> 'open' then
    raise exception 'Charging the table closed the session on its own'; end if;
  if card.in_person_payment_attended_at is null or card.bill_attended_at is distinct from attended then
    raise exception 'pos_open_sessions does not expose what was already attended'; end if;
  perform set_config('role', 'postgres', true);

  -- Atendida la solicitud, la mesa puede volver a llamar. (No se comparan horas:
  -- `now()` es la de la transacción, y acá todo corre dentro de una sola.)
  perform set_config('request.jwt.claim.sub', diner::text, true);
  again := public.request_session_service(sid, 'bill');
  if again is null
    or (select bill_requested_at from public.table_sessions where id = sid) is distinct from again then
    raise exception 'A table cannot ask again after being attended'; end if;
  -- Volver a llamar limpia la confirmación vieja: la mesa no puede estar a la
  -- vez esperando y atendida.
  select * into saved from public.table_sessions where id = sid;
  if saved.bill_attended_at is not null then
    raise exception 'Asking again kept the old confirmation'; end if;
  if saved.in_person_payment_attended_at is null then
    raise exception 'Asking for one thing touched what was attended of the other'; end if;

  raise notice 'Session request SQL assertions passed (auth, membership, idempotency, independence, POS visibility, attend audit, diner confirmation)';
end;
$$;

rollback;

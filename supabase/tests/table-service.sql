-- Avisos al salón: request_table_service es el único camino del comensal hacia
-- una persona, así que valida participación, se puede cancelar y no reinicia la
-- espera que ve el mozo. El plano del POS deriva su estado de estas columnas.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_service_error(
  sid uuid, kind text, requested boolean, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.request_table_service(sid, kind, requested);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  ana uuid := gen_random_uuid();
  beto uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  dining_table uuid;
  sid uuid;
  closed_sid uuid;
  first_call timestamptz;
begin
  insert into auth.users(id, aud, role) values
    (ana,'authenticated','authenticated'), (beto,'authenticated','authenticated'),
    (outsider,'authenticated','authenticated');
  insert into public.restaurants(name, slug) values('Service test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant,'Centro') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch,'Mesa 1')
    returning id into dining_table;

  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.table_sessions(restaurant_id, table_id, status, closed_at)
    values(restaurant, dining_table,'closed', now()) returning id into closed_sid;

  insert into public.session_participants(session_id, user_id, display_name) values
    (sid, ana,'Ana'), (sid, beto,'Beto');

  -- ---------- Sesión y permisos ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_service_error(sid, 'attention', true, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_service_error(sid, 'attention', true, 'NOT_PARTICIPANT');
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform pg_temp.expect_service_error(gen_random_uuid(), 'attention', true, 'SESSION_NOT_FOUND');
  perform pg_temp.expect_service_error(closed_sid, 'attention', true, 'SESSION_CLOSED');
  -- Un aviso que el salón no sabe leer no se guarda.
  perform pg_temp.expect_service_error(sid, 'otra-cosa', true, 'INVALID_REQUEST');

  if (select attention_requested_at is not null or bill_requested_at is not null
      from public.table_sessions where id = sid) then
    raise exception 'Rejected requests should not flag the table'; end if;

  -- ---------- Llamar al mozo ----------
  perform public.request_table_service(sid, 'attention');
  select attention_requested_at into first_call from public.table_sessions where id = sid;
  if first_call is null then raise exception 'The waiter call was not recorded'; end if;
  if (select bill_requested_at from public.table_sessions where id = sid) is not null then
    raise exception 'Calling the waiter must not request the bill'; end if;

  -- Otro comensal pidiendo lo mismo no reinicia la espera del primero.
  perform set_config('request.jwt.claim.sub', beto::text, true);
  perform public.request_table_service(sid, 'attention');
  if (select attention_requested_at from public.table_sessions where id = sid) <> first_call then
    raise exception 'A second call should keep the original timestamp'; end if;

  -- ---------- Cancelar ----------
  perform public.request_table_service(sid, 'attention', false);
  if (select attention_requested_at from public.table_sessions where id = sid) is not null then
    raise exception 'Cancelling should clear the waiter call'; end if;

  -- ---------- Pedir la cuenta ----------
  perform public.request_table_service(sid, 'bill');
  if (select bill_requested_at from public.table_sessions where id = sid) is null then
    raise exception 'The bill request was not recorded'; end if;
  perform public.request_table_service(sid, 'bill', false);
  if (select bill_requested_at from public.table_sessions where id = sid) is not null then
    raise exception 'Cancelling should clear the bill request'; end if;

  -- El comensal nunca escribe la sesión de forma directa.
  if has_table_privilege('authenticated', 'public.table_sessions', 'UPDATE')
    or has_function_privilege('anon', 'public.request_table_service(uuid,text,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.request_table_service(uuid,text,boolean)', 'EXECUTE') then
    raise exception 'Wrong table service privileges'; end if;

  raise notice 'Table service SQL assertions passed (auth, membership, kinds, idempotent wait, cancel, privileges)';
end;
$$;

rollback;

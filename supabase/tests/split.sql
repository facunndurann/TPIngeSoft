-- División de la cuenta: la RPC update_session_split valida en Postgres, no en
-- el `disabled` de un botón. Todos los rechazos usan códigos del catálogo
-- compartido (packages/shared/src/errors.ts).
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_split_error(
  sid uuid, split public.split_type, allocations jsonb, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.update_session_split(sid, split, allocations);
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
  ana_participant uuid;
  beto_participant uuid;
  stranger_participant uuid;
  saved public.table_sessions;
begin
  insert into auth.users(id, aud, role) values
    (ana,'authenticated','authenticated'), (beto,'authenticated','authenticated'),
    (outsider,'authenticated','authenticated');
  insert into public.restaurants(name, slug) values('Split test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant,'Centro') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch,'Mesa 1')
    returning id into dining_table;

  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.table_sessions(restaurant_id, table_id, status, closed_at)
    values(restaurant, dining_table,'closed', now()) returning id into closed_sid;

  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, ana,'Ana') returning id into ana_participant;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, beto,'Beto') returning id into beto_participant;
  -- Comensal de OTRA sesión: su id no puede colarse en las asignaciones.
  insert into public.session_participants(session_id, user_id, display_name)
    values(closed_sid, outsider,'Ajeno') returning id into stranger_participant;

  -- La columna es un enum real, igual que order_status o menu_design.
  if (select atttypid::regtype::text from pg_attribute
      where attrelid = 'public.table_sessions'::regclass and attname = 'split_type')
     <> 'split_type' then
    raise exception 'split_type should be an enum column'; end if;
  if (select split_type from public.table_sessions where id = sid) <> 'none' then
    raise exception 'New sessions should start undivided'; end if;

  -- ---------- Sesión y permisos ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_split_error(sid, 'equal', '{}'::jsonb, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_split_error(sid, 'equal', '{}'::jsonb, 'NOT_PARTICIPANT');
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform pg_temp.expect_split_error(gen_random_uuid(), 'equal', '{}'::jsonb, 'SESSION_NOT_FOUND');
  perform pg_temp.expect_split_error(closed_sid, 'equal', '{}'::jsonb, 'SESSION_CLOSED');

  -- ---------- Forma de la división ----------
  -- Asignaciones fuera de percentages: es lo que dejaba porcentajes zombis.
  perform pg_temp.expect_split_error(
    sid, 'equal', jsonb_build_object(ana_participant::text, 100), 'INVALID_SPLIT');
  -- No suman 100.
  perform pg_temp.expect_split_error(
    sid, 'percentages', jsonb_build_object(ana_participant::text, 60), 'INVALID_SPLIT');
  perform pg_temp.expect_split_error(
    sid, 'percentages',
    jsonb_build_object(ana_participant::text, 60, beto_participant::text, 60), 'INVALID_SPLIT');
  -- Claves que no son comensales de ESTA sesión.
  perform pg_temp.expect_split_error(
    sid, 'percentages', jsonb_build_object(stranger_participant::text, 100), 'INVALID_SPLIT');
  perform pg_temp.expect_split_error(
    sid, 'percentages', jsonb_build_object('no-soy-un-uuid', 100), 'INVALID_SPLIT');
  -- Valores fuera de rango o que ni siquiera son números.
  perform pg_temp.expect_split_error(
    sid, 'percentages',
    jsonb_build_object(ana_participant::text, 140, beto_participant::text, -40), 'INVALID_SPLIT');
  perform pg_temp.expect_split_error(
    sid, 'percentages', jsonb_build_object(ana_participant::text, 'cien'), 'INVALID_SPLIT');
  perform pg_temp.expect_split_error(sid, 'percentages', '[]'::jsonb, 'INVALID_SPLIT');

  select * into saved from public.table_sessions where id = sid;
  if saved.split_type <> 'none' or saved.split_allocations <> '{}'::jsonb then
    raise exception 'Rejected splits should leave the session untouched'; end if;

  -- ---------- Guardados válidos ----------
  perform public.update_session_split(
    sid, 'percentages',
    jsonb_build_object(ana_participant::text, 33.34, beto_participant::text, 66.66));
  select * into saved from public.table_sessions where id = sid;
  if saved.split_type <> 'percentages'
     or (saved.split_allocations ->> ana_participant::text)::numeric <> 33.34 then
    raise exception 'Percentages split was not stored'; end if;

  -- Volver a otro modo limpia las asignaciones: no quedan datos viejos.
  perform set_config('request.jwt.claim.sub', beto::text, true);
  perform public.update_session_split(sid, 'none');
  select * into saved from public.table_sessions where id = sid;
  if saved.split_type <> 'none' or saved.split_allocations <> '{}'::jsonb then
    raise exception 'Switching away from percentages should clear allocations'; end if;

  perform public.update_session_split(sid, 'equal', '{}'::jsonb);
  if (select split_type from public.table_sessions where id = sid) <> 'equal' then
    raise exception 'Equal split was not stored'; end if;

  raise notice 'Split SQL assertions passed (enum column, auth, membership, allocation shape, cleanup)';
end;
$$;

rollback;

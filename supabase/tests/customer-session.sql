-- Ingreso del comensal por QR: customer_join_table_session rechaza con códigos
-- del catálogo compartido (packages/shared/src/errors.ts), nunca con texto
-- suelto, para que la app muestre siempre el mensaje en español.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_join_error(qr text, participant_name text, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.join_table_session(qr, participant_name);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  diner uuid := gen_random_uuid();
  newcomer uuid := gen_random_uuid();
  employee uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  closed_branch uuid;
  open_table uuid;
  inactive_table uuid;
  hidden_branch_table uuid;
  open_qr text;
  sid uuid;
  rejoined uuid;
begin
  insert into auth.users(id, aud, role) values
    (diner,'authenticated','authenticated'), (newcomer,'authenticated','authenticated'),
    (employee,'authenticated','authenticated');
  -- Un perfil convierte al usuario en cuenta del personal: el QR no es para ellos.
  insert into public.profiles(id, username_normalized, full_name)
    values(employee, replace(employee::text, '-', ''), 'Mozo de prueba');

  insert into public.restaurants(name, slug) values('Join test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant,'Centro') returning id into branch;
  insert into public.branches(restaurant_id, name, is_active)
    values(restaurant,'Depósito', false) returning id into closed_branch;

  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, branch,'Mesa 1') returning id into open_table;
  insert into public.tables(restaurant_id, branch_id, label, is_active)
    values(restaurant, branch,'Mesa 2', false) returning id into inactive_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, closed_branch,'Mesa 3') returning id into hidden_branch_table;

  select qr_token into open_qr from public.tables where id = open_table;

  -- ---------- Sesión y permisos ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_join_error(open_qr, 'Ana', 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', employee::text, true);
  perform pg_temp.expect_join_error(open_qr, 'Mozo', 'FORBIDDEN');

  -- ---------- Nombre ----------
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_join_error(open_qr, repeat('a', 41), 'INVALID_NAME');
  perform pg_temp.expect_join_error(open_qr, '   ', 'INVALID_NAME');

  -- ---------- Mesa ----------
  perform pg_temp.expect_join_error('no-existe-este-qr', 'Ana', 'TABLE_UNAVAILABLE');
  perform pg_temp.expect_join_error(
    (select qr_token from public.tables where id = inactive_table), 'Ana', 'TABLE_UNAVAILABLE');
  -- La sucursal cerrada tampoco abre mesa, aunque la mesa esté activa.
  perform pg_temp.expect_join_error(
    (select qr_token from public.tables where id = hidden_branch_table), 'Ana', 'TABLE_UNAVAILABLE');

  if exists (select 1 from public.table_sessions where table_id in (open_table, inactive_table)) then
    raise exception 'Rejected joins should not open a session'; end if;

  -- ---------- Ingreso válido ----------
  sid := public.join_table_session(open_qr, '  Ana  ');
  if (select status from public.table_sessions where id = sid) <> 'open' then
    raise exception 'A valid join should open a session'; end if;
  if (select display_name from public.session_participants
      where session_id = sid and user_id = diner) <> 'Ana' then
    raise exception 'The participant name should be stored trimmed'; end if;

  -- Volver a entrar sin nombre conserva el que ya tenía y la misma mesa.
  rejoined := public.join_table_session(open_qr, null);
  if rejoined <> sid then raise exception 'Rejoining should reuse the open session'; end if;
  if (select display_name from public.session_participants
      where session_id = sid and user_id = diner) <> 'Ana' then
    raise exception 'Rejoining without a name should keep the stored one'; end if;

  -- Un comensal nuevo sin nombre entra como Comensal a la misma mesa.
  perform set_config('request.jwt.claim.sub', newcomer::text, true);
  if public.join_table_session(open_qr, null) <> sid then
    raise exception 'A second diner should join the same open session'; end if;
  if (select display_name from public.session_participants
      where session_id = sid and user_id = newcomer) <> 'Comensal' then
    raise exception 'A nameless diner should default to Comensal'; end if;

  raise notice 'Customer session SQL assertions passed (auth, staff guard, name, table availability, rejoin)';
end;
$$;

rollback;

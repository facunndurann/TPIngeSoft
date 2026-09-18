-- MI-64: abrir o continuar una comanda desde el plano.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_open_error(tid uuid, eid uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_open_table_session(tid, eid);
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
  outsider uuid := gen_random_uuid();
  other_staff uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  restaurant uuid;
  other_restaurant uuid;
  branch uuid;
  closed_branch uuid;
  section uuid;
  closed_section uuid;
  other_branch uuid;
  dining_table uuid;
  inactive_table uuid;
  hidden_table uuid;
  closed_section_table uuid;
  closed_branch_table uuid;
  loose_table uuid;
  other_table uuid;
  employee uuid;
  other_employee uuid;
  sid uuid;
  again uuid;
  reopened uuid;
  log_count integer;
begin
  insert into auth.users(id, aud, role) values
    (staff, 'authenticated', 'authenticated'),
    (outsider, 'authenticated', 'authenticated'),
    (other_staff, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('Open session test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('Open session other', gen_random_uuid()::text)
    returning id into other_restaurant;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, staff, 'owner'), (other_restaurant, other_staff, 'owner');

  insert into public.branches(restaurant_id, name) values(restaurant, 'Centro')
    returning id into branch;
  insert into public.branches(restaurant_id, name, is_active) values(restaurant, 'Cerrada', false)
    returning id into closed_branch;
  insert into public.branches(restaurant_id, name) values(other_restaurant, 'Ajena')
    returning id into other_branch;

  insert into public.floor_sections(restaurant_id, branch_id, name)
    values(restaurant, branch, 'Salón') returning id into section;
  insert into public.floor_sections(restaurant_id, branch_id, name, is_active)
    values(restaurant, branch, 'Terraza', false) returning id into closed_section;

  insert into public.tables(restaurant_id, branch_id, section_id, label)
    values(restaurant, branch, section, 'Mesa 1') returning id into dining_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label, is_active)
    values(restaurant, branch, section, 'Mesa fuera de servicio', false)
    returning id into inactive_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label, is_visible)
    values(restaurant, branch, section, 'Barra', false) returning id into hidden_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label)
    values(restaurant, branch, closed_section, 'Mesa de terraza')
    returning id into closed_section_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, closed_branch, 'Mesa de sucursal cerrada')
    returning id into closed_branch_table;
  -- Sin sector: sigue siendo operable, existe y tiene QR.
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, branch, 'Mesa suelta') returning id into loose_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(other_restaurant, other_branch, 'Mesa ajena') returning id into other_table;

  insert into public.pos_employees(restaurant_id, full_name, pin_hash)
    values(restaurant, 'Ana', 'unused-hash') returning id into employee;
  insert into public.pos_employees(restaurant_id, full_name, pin_hash)
    values(other_restaurant, 'Ajeno', 'unused-hash') returning id into other_employee;

  -- ---------- Autenticación y permisos ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_open_error(dining_table, null, 'AUTH_REQUIRED');

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_open_error(dining_table, null, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_staff::text, true);
  perform pg_temp.expect_open_error(dining_table, null, 'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform pg_temp.expect_open_error(null, null, 'INVALID_REQUEST');
  perform pg_temp.expect_open_error(gen_random_uuid(), null, 'TABLE_NOT_FOUND');
  -- Una mesa de otro restaurante no se distingue de una ajena: falla por permiso.
  perform pg_temp.expect_open_error(other_table, null, 'FORBIDDEN');

  -- ---------- Mesas que no se pueden operar (MI-66) ----------
  perform pg_temp.expect_open_error(inactive_table, null, 'TABLE_UNAVAILABLE');
  perform pg_temp.expect_open_error(hidden_table, null, 'TABLE_UNAVAILABLE');
  perform pg_temp.expect_open_error(closed_section_table, null, 'TABLE_UNAVAILABLE');
  perform pg_temp.expect_open_error(closed_branch_table, null, 'TABLE_UNAVAILABLE');
  if exists (select 1 from public.table_sessions where table_id in
    (inactive_table, hidden_table, closed_section_table, closed_branch_table)) then
    raise exception 'A non-operable table got a session'; end if;

  -- Una mesa sin sector sí se opera.
  if public.pos_open_table_session(loose_table, null) is null then
    raise exception 'A table without a section could not be opened'; end if;

  -- ---------- Abrir ----------
  sid := public.pos_open_table_session(dining_table, employee);
  if sid is null then raise exception 'Opening returned no session'; end if;
  if (select status from public.table_sessions where id = sid) <> 'open' then
    raise exception 'The new session is not open'; end if;
  if (select assigned_employee_id from public.table_sessions where id = sid) <> employee then
    raise exception 'The operator was not assigned to the session'; end if;
  -- El mozo no es comensal de la mesa.
  if exists (select 1 from public.session_participants where session_id = sid) then
    raise exception 'Opening from the POS added a participant'; end if;

  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'session.opened' and session_id = sid
      and employee_id = employee and details->>'tableId' = dining_table::text;
  if log_count <> 1 then raise exception 'Opening was not audited'; end if;

  -- ---------- Continuar: idempotente ----------
  again := public.pos_open_table_session(dining_table, employee);
  if again <> sid then raise exception 'Continuing created a different session'; end if;
  if (select count(*) from public.table_sessions where table_id = dining_table) <> 1 then
    raise exception 'Continuing duplicated the session'; end if;
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'session.resumed' and session_id = sid;
  if log_count <> 1 then raise exception 'Continuing was not audited as resumed'; end if;

  -- Continuar sin empleado no borra al responsable ya asignado.
  perform public.pos_open_table_session(dining_table, null);
  if (select assigned_employee_id from public.table_sessions where id = sid) <> employee then
    raise exception 'Continuing without an operator cleared the assignee'; end if;

  -- ---------- Empleado inválido ----------
  perform pg_temp.expect_open_error(loose_table, other_employee, 'EMPLOYEE_NOT_FOUND');
  perform set_config('request.jwt.claim.sub', staff::text, true);
  update public.pos_employees set is_active = false where id = employee;
  perform pg_temp.expect_open_error(dining_table, employee, 'EMPLOYEE_NOT_FOUND');
  update public.pos_employees set is_active = true where id = employee;

  -- El rechazo por empleado no deja una sesión a medio crear.
  if (select count(*) from public.table_sessions where table_id = loose_table) <> 1 then
    raise exception 'A rejected operator left an extra session behind'; end if;

  -- ---------- Compatibilidad con el resto del POS ----------
  -- El comensal que escanea el QR entra a la sesión que abrió el mozo.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if public.join_table_session(
    (select t.qr_token from public.tables t where t.id = dining_table), 'Diner') <> sid then
    raise exception 'The QR opened a second session for a table the POS already opened'; end if;

  -- Cerrar y volver a abrir da una sesión nueva, no revive la cerrada.
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform public.pos_close_table_session(sid, employee);
  reopened := public.pos_open_table_session(dining_table, employee);
  if reopened = sid then raise exception 'Reopening reused the closed session'; end if;
  if (select count(*) from public.table_sessions where table_id = dining_table and status = 'open') <> 1 then
    raise exception 'The table ended with more than one open session'; end if;

  -- ---------- Privilegios ----------
  if has_function_privilege('anon', 'public.pos_open_table_session(uuid, uuid)', 'EXECUTE') then
    raise exception 'Anonymous visitors can open POS sessions'; end if;
  if not has_function_privilege('authenticated', 'public.pos_open_table_session(uuid, uuid)', 'EXECUTE') then
    raise exception 'Staff cannot open POS sessions'; end if;

  raise notice 'POS open-session SQL assertions passed (auth, operability, idempotency, audit, reopen)';
end;
$$;

rollback;

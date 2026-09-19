-- MI-64: abrir o continuar una comanda desde el plano.
-- Reescrito sobre cuentas globales: el operador sale de auth.uid() y su permiso
-- de sucursal, no de un id de empleado que mandaba el cliente.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_open_error(tid uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_open_table_session(tid);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  waiter uuid := gen_random_uuid();
  mate uuid := gen_random_uuid();
  cook uuid := gen_random_uuid();
  admin_owner uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  other_waiter uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  restaurant uuid; other_restaurant uuid;
  branch uuid; closed_branch uuid; other_branch uuid;
  section uuid; closed_section uuid;
  dining_table uuid; inactive_table uuid; hidden_table uuid;
  closed_section_table uuid; closed_branch_table uuid; loose_table uuid; other_table uuid;
  mid uuid; sid uuid; again uuid; reopened uuid; log_count integer;
begin
  insert into auth.users(id, aud, role) values
    (waiter,'authenticated','authenticated'), (mate,'authenticated','authenticated'),
    (cook,'authenticated','authenticated'), (admin_owner,'authenticated','authenticated'),
    (outsider,'authenticated','authenticated'), (other_waiter,'authenticated','authenticated'),
    (diner,'authenticated','authenticated');
  insert into public.restaurants(name, slug) values('Open session test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('Open session other', gen_random_uuid()::text)
    returning id into other_restaurant;

  insert into public.branches(restaurant_id, name) values(restaurant,'Centro') returning id into branch;
  insert into public.branches(restaurant_id, name, is_active) values(restaurant,'Cerrada',false)
    returning id into closed_branch;
  insert into public.branches(restaurant_id, name) values(other_restaurant,'Ajena') returning id into other_branch;

  insert into public.floor_sections(restaurant_id, branch_id, name)
    values(restaurant, branch,'Salón') returning id into section;
  insert into public.floor_sections(restaurant_id, branch_id, name, is_active)
    values(restaurant, branch,'Terraza',false) returning id into closed_section;

  insert into public.tables(restaurant_id, branch_id, section_id, label)
    values(restaurant, branch, section,'Mesa 1') returning id into dining_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label, is_active)
    values(restaurant, branch, section,'Mesa fuera de servicio',false) returning id into inactive_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label, is_visible)
    values(restaurant, branch, section,'Barra',false) returning id into hidden_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label)
    values(restaurant, branch, closed_section,'Mesa de terraza') returning id into closed_section_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, closed_branch,'Mesa de sucursal cerrada') returning id into closed_branch_table;
  -- Sin sector: sigue siendo operable, existe y tiene QR.
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, branch,'Mesa suelta') returning id into loose_table;
  insert into public.tables(restaurant_id, branch_id, label)
    values(other_restaurant, other_branch,'Mesa ajena') returning id into other_table;

  -- El dueño administrativo no tiene perfil: administra, no opera el salón.
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(restaurant, admin_owner,'owner');

  insert into public.profiles(id, username_normalized, full_name) values
    (waiter,'open.waiter','Ana'), (mate,'open.mate','Beto'),
    (cook,'open.cook','Caro'), (other_waiter,'open.other','Ajeno');
  -- supervisor cubre abrir, mover y cerrar; kitchen no abre nada.
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(restaurant, waiter,'supervisor') returning id into mid;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id) values(mid, restaurant, branch);
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(restaurant, mate,'supervisor') returning id into mid;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id) values(mid, restaurant, branch);
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(restaurant, cook,'kitchen') returning id into mid;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id) values(mid, restaurant, branch);
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(other_restaurant, other_waiter,'supervisor') returning id into mid;
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    values(mid, other_restaurant, other_branch);

  -- ---------- Autenticación y permisos ----------
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_open_error(dining_table,'AUTH_REQUIRED');

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_open_error(dining_table,'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', other_waiter::text, true);
  perform pg_temp.expect_open_error(dining_table,'FORBIDDEN');
  -- El POS no tiene fallback administrativo: el dueño no abre mesas.
  perform set_config('request.jwt.claim.sub', admin_owner::text, true);
  perform pg_temp.expect_open_error(dining_table,'FORBIDDEN');
  -- Cocina ve el tablero pero no opera el salón.
  perform set_config('request.jwt.claim.sub', cook::text, true);
  perform pg_temp.expect_open_error(dining_table,'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', waiter::text, true);
  perform pg_temp.expect_open_error(null,'INVALID_REQUEST');
  perform pg_temp.expect_open_error(gen_random_uuid(),'TABLE_NOT_FOUND');
  -- Una mesa de otro restaurante no se distingue de una ajena: falla por permiso.
  perform pg_temp.expect_open_error(other_table,'FORBIDDEN');

  -- ---------- Mesas que no se pueden operar (MI-66) ----------
  perform pg_temp.expect_open_error(inactive_table,'TABLE_UNAVAILABLE');
  perform pg_temp.expect_open_error(hidden_table,'TABLE_UNAVAILABLE');
  perform pg_temp.expect_open_error(closed_section_table,'TABLE_UNAVAILABLE');
  -- Una sucursal dada de baja ya no otorga permiso: corta antes, por alcance.
  perform pg_temp.expect_open_error(closed_branch_table,'FORBIDDEN');
  if exists (select 1 from public.table_sessions where table_id in
    (inactive_table, hidden_table, closed_section_table, closed_branch_table)) then
    raise exception 'A non-operable table got a session'; end if;

  -- Una mesa sin sector sí se opera.
  if public.pos_open_table_session(loose_table) is null then
    raise exception 'A table without a section could not be opened'; end if;

  -- ---------- Abrir ----------
  sid := public.pos_open_table_session(dining_table);
  if sid is null then raise exception 'Opening returned no session'; end if;
  if (select status from public.table_sessions where id = sid) <> 'open' then
    raise exception 'The new session is not open'; end if;
  if (select assigned_user_id from public.table_sessions where id = sid) <> waiter then
    raise exception 'The operator was not assigned to the session'; end if;
  -- El mozo no es comensal de la mesa.
  if exists (select 1 from public.session_participants where session_id = sid) then
    raise exception 'Opening from the POS added a participant'; end if;

  -- La auditoría guarda la cuenta y la sucursal, no un id que mandó el cliente.
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'session.opened' and session_id = sid
      and actor_user_id = waiter and branch_id = branch
      and details->>'tableId' = dining_table::text;
  if log_count <> 1 then raise exception 'Opening was not audited'; end if;

  -- ---------- Continuar: idempotente ----------
  again := public.pos_open_table_session(dining_table);
  if again <> sid then raise exception 'Continuing created a different session'; end if;
  if (select count(*) from public.table_sessions where table_id = dining_table) <> 1 then
    raise exception 'Continuing duplicated the session'; end if;
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'session.resumed' and session_id = sid;
  if log_count <> 1 then raise exception 'Continuing was not audited as resumed'; end if;

  -- Continuar deja al operador actual como responsable de la mesa.
  perform set_config('request.jwt.claim.sub', mate::text, true);
  perform public.pos_open_table_session(dining_table);
  if (select assigned_user_id from public.table_sessions where id = sid) <> mate then
    raise exception 'Continuing did not hand the table over to the current operator'; end if;

  -- Un rechazo no deja una sesión a medio crear.
  if (select count(*) from public.table_sessions where table_id = loose_table) <> 1 then
    raise exception 'A rejected operator left an extra session behind'; end if;

  -- ---------- Compatibilidad con el resto del POS ----------
  -- El comensal que escanea el QR entra a la sesión que abrió el mozo.
  perform set_config('request.jwt.claim.sub', diner::text, true);
  if public.join_table_session(
    (select t.qr_token from public.tables t where t.id = dining_table),'Diner') <> sid then
    raise exception 'The QR opened a second session for a table the POS already opened'; end if;

  -- Cerrar y volver a abrir da una sesión nueva, no revive la cerrada.
  perform set_config('request.jwt.claim.sub', waiter::text, true);
  perform public.pos_close_table_session(sid);
  reopened := public.pos_open_table_session(dining_table);
  if reopened = sid then raise exception 'Reopening reused the closed session'; end if;
  if (select count(*) from public.table_sessions where table_id = dining_table and status = 'open') <> 1 then
    raise exception 'The table ended with more than one open session'; end if;

  -- ---------- Privilegios ----------
  if has_function_privilege('anon','public.pos_open_table_session(uuid)','EXECUTE') then
    raise exception 'Anonymous visitors can open POS sessions'; end if;
  if not has_function_privilege('authenticated','public.pos_open_table_session(uuid)','EXECUTE') then
    raise exception 'Staff cannot open POS sessions'; end if;
  -- La firma vieja con id de empleado no debe sobrevivir al merge.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_open_table_session' and p.pronargs = 2) then
    raise exception 'The PIN-era open signature is still installed'; end if;

  raise notice 'POS open-session SQL assertions passed (accounts, permissions, operability, idempotency, audit, reopen)';
end;
$$;

rollback;

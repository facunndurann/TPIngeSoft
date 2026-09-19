-- Abrir (MI-64) y trasladar (MI-65) comandas llegaron escritas contra el modelo
-- de empleados con PIN: reciben p_employee_id y llaman a record_pos_action con
-- ese id en la segunda posición. La firma nueva tiene la misma aridad y tipos,
-- pero esa posición ahora es la sucursal, así que las versiones originales
-- fallarían siempre con FORBIDDEN sin error visible de migración. Se rehacen
-- sobre la cuenta autenticada.

-- Operar el salón es un permiso propio: cocina y caja ven el plano pero no lo operan.
insert into public.role_permissions
select r::public.member_role, p
from unnest(array['owner','manager','supervisor','waiter','staff']) r
cross join unnest(array['sessions.open','sessions.move']) p
on conflict do nothing;

drop function if exists public.pos_open_table_session(uuid, uuid);
drop function if exists public.pos_move_table_session(uuid, uuid, uuid, uuid);

create function public.pos_open_table_session(p_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target public.tables; sid uuid; created boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_table_id is null then raise exception 'INVALID_REQUEST'; end if;
  -- Mismo orden de bloqueo mesa -> sesión que join/close: dos aperturas
  -- simultáneas se serializan acá y la idempotencia evita duplicados.
  select * into target from tables where id = p_table_id for update;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  -- La cuenta administrativa no opera el salón: el POS es de empleados.
  if not exists(select 1 from profiles where id = auth.uid())
    or not public.has_permission(target.restaurant_id,'sessions.open',target.branch_id)
    then raise exception 'FORBIDDEN'; end if;
  -- Misma regla de operabilidad que dibuja el plano (MI-66).
  if not target.is_active or not target.is_visible
    or not exists(select 1 from branches where id = target.branch_id and is_active)
    or (target.section_id is not null and not exists(
      select 1 from floor_sections where id = target.section_id and is_active))
    then raise exception 'TABLE_UNAVAILABLE'; end if;

  select id into sid from table_sessions where table_id = target.id and status = 'open' for update;
  if sid is null then
    insert into table_sessions(restaurant_id, table_id, assigned_user_id)
      values(target.restaurant_id, target.id, auth.uid()) returning id into sid;
    created := true;
  else
    -- Continuar también deja al operador actual como responsable de la mesa.
    update table_sessions set assigned_user_id = auth.uid() where id = sid;
  end if;
  perform public.record_pos_action(target.restaurant_id, target.branch_id,
    case when created then 'session.opened' else 'session.resumed' end, null, sid,
    jsonb_build_object('tableId', target.id, 'tableLabel', target.label));
  return sid;
end;
$$;

create function public.pos_move_table_session(
  p_session_id uuid, p_source_table_id uuid, p_destination_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare source_table public.tables; destination public.tables; target public.table_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_source_table_id is null or p_destination_table_id is null
    or p_source_table_id = p_destination_table_id then raise exception 'INVALID_REQUEST'; end if;
  -- Orden estable entre las dos mesas para serializar traslados competidores.
  perform id from tables where id in (p_source_table_id, p_destination_table_id) order by id for update;
  select * into source_table from tables where id = p_source_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  select * into destination from tables where id = p_destination_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  if destination.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  if destination.branch_id <> source_table.branch_id then raise exception 'TABLE_BRANCH_MISMATCH'; end if;
  -- El permiso se exige en la sucursal de origen; el destino comparte sucursal.
  if not exists(select 1 from profiles where id = auth.uid())
    or not public.has_permission(source_table.restaurant_id,'sessions.move',source_table.branch_id)
    then raise exception 'FORBIDDEN'; end if;

  select * into target from table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  -- El origen esperado evita mover otra vez una comanda ya trasladada.
  if target.status <> 'open' or target.table_id <> source_table.id then
    raise exception 'SESSION_MOVE_CONFLICT'; end if;
  if not destination.is_active or not destination.is_visible
    or not exists(select 1 from branches where id = destination.branch_id and is_active)
    or (destination.section_id is not null and not exists(
      select 1 from floor_sections where id = destination.section_id and is_active))
    then raise exception 'TABLE_UNAVAILABLE'; end if;
  if exists(select 1 from table_sessions where table_id = destination.id and status = 'open')
    then raise exception 'TABLE_OCCUPIED'; end if;

  -- Pedidos, participantes, pagos y reparto siguen colgando del mismo id.
  update table_sessions set table_id = destination.id, assigned_user_id = auth.uid() where id = target.id;
  perform public.record_pos_action(source_table.restaurant_id, source_table.branch_id,
    'session.moved', null, target.id, jsonb_build_object(
      'sourceTableId', source_table.id, 'sourceTableLabel', source_table.label,
      'destinationTableId', destination.id, 'destinationTableLabel', destination.label));
  return target.id;
end;
$$;

revoke all on function public.pos_open_table_session(uuid),
  public.pos_move_table_session(uuid,uuid,uuid) from public, anon;
grant execute on function public.pos_open_table_session(uuid),
  public.pos_move_table_session(uuid,uuid,uuid) to authenticated;

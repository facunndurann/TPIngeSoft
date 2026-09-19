-- MI-65: trasladar una comanda completa, sin recrear pedidos ni cuenta.
create or replace function public.pos_move_table_session(
  p_session_id uuid,
  p_source_table_id uuid,
  p_destination_table_id uuid,
  p_employee_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  source_table public.tables;
  destination public.tables;
  target public.table_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_source_table_id is null or p_destination_table_id is null
    or p_source_table_id = p_destination_table_id then raise exception 'INVALID_REQUEST'; end if;

  -- Mesa -> sesión, como apertura/QR/cierre. Orden estable entre las dos mesas
  -- para serializar traslados competidores sin invertir los bloqueos.
  perform id from public.tables where id in (p_source_table_id, p_destination_table_id)
    order by id for update;
  select * into source_table from public.tables where id = p_source_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  select * into destination from public.tables where id = p_destination_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  if not public.is_restaurant_member(source_table.restaurant_id)
    or destination.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  if destination.branch_id <> source_table.branch_id then raise exception 'TABLE_BRANCH_MISMATCH'; end if;

  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  -- El origen esperado evita mover otra vez una comanda trasladada desde otro dispositivo.
  if target.status <> 'open' or target.table_id <> source_table.id then
    raise exception 'SESSION_MOVE_CONFLICT';
  end if;
  if not destination.is_active or not destination.is_visible
    or not exists (select 1 from public.branches where id = destination.branch_id and is_active)
    or (destination.section_id is not null and not exists (
      select 1 from public.floor_sections where id = destination.section_id and is_active
    )) then raise exception 'TABLE_UNAVAILABLE'; end if;
  if exists (select 1 from public.table_sessions where table_id = destination.id and status = 'open') then
    raise exception 'TABLE_OCCUPIED';
  end if;

  update public.table_sessions set table_id = destination.id where id = target.id;
  -- Los pedidos, participantes, pagos y reparto siguen vinculados al mismo id.
  -- Si falla la validación del empleado o la auditoría, también se revierte el traslado.
  perform public.record_pos_action(source_table.restaurant_id, p_employee_id, 'session.moved',
    null, target.id, jsonb_build_object(
      'sourceTableId', source_table.id, 'sourceTableLabel', source_table.label,
      'destinationTableId', destination.id, 'destinationTableLabel', destination.label
    ));
  return target.id;
end;
$$;

revoke all on function public.pos_move_table_session(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.pos_move_table_session(uuid, uuid, uuid, uuid) to authenticated;

-- ============================================================
-- MI-64: abrir o continuar una comanda desde una mesa del mapa.
--
-- Hasta ahora una sesión de mesa solo nacía por QR (join_table_session), que
-- además suma a quien llama como comensal. El mozo necesita abrirla desde el
-- POS sin convertirse en participante de la mesa.
--
-- La función es idempotente por diseño: si la mesa ya tiene sesión abierta la
-- devuelve en vez de fallar, así "abrir" y "continuar" son la misma acción y
-- dos mozos que tocan la misma mesa a la vez no crean nada duplicado.
-- ============================================================

create or replace function public.pos_open_table_session(
  p_table_id uuid,
  p_employee_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.tables;
  v_branch_active boolean;
  v_section_active boolean;
  sid uuid;
  created boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_table_id is null then raise exception 'INVALID_REQUEST'; end if;

  -- Mismo orden de bloqueo mesa -> sesión que join_table_session y
  -- close_table_session: dos aperturas simultáneas se serializan acá.
  select * into target from public.tables where id = p_table_id for update;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;

  -- Misma regla de operabilidad que dibuja el plano (MI-66): una mesa fuera de
  -- servicio, oculta, o de un sector/sucursal dado de baja no se opera.
  select b.is_active into v_branch_active from public.branches b where b.id = target.branch_id;
  if not target.is_active or not target.is_visible or not coalesce(v_branch_active, false) then
    raise exception 'TABLE_UNAVAILABLE';
  end if;
  if target.section_id is not null then
    select s.is_active into v_section_active
      from public.floor_sections s where s.id = target.section_id;
    if not coalesce(v_section_active, false) then raise exception 'TABLE_UNAVAILABLE'; end if;
  end if;

  select id into sid from public.table_sessions
    where table_id = target.id and status = 'open' for update;

  if sid is null then
    insert into public.table_sessions(restaurant_id, table_id, assigned_employee_id)
      values(target.restaurant_id, target.id, p_employee_id)
      returning id into sid;
    created := true;
  elsif p_employee_id is not null then
    -- Continuar también deja al operador actual como responsable de la mesa.
    update public.table_sessions set assigned_employee_id = p_employee_id where id = sid;
  end if;

  -- Valida el empleado y audita. Si el empleado no es del restaurante, la
  -- excepción revierte también la sesión recién creada.
  perform public.record_pos_action(
    target.restaurant_id,
    p_employee_id,
    case when created then 'session.opened' else 'session.resumed' end,
    null,
    sid,
    jsonb_build_object('tableId', target.id, 'tableLabel', target.label)
  );

  return sid;
end;
$$;

revoke all on function public.pos_open_table_session(uuid, uuid) from public, anon;
grant execute on function public.pos_open_table_session(uuid, uuid) to authenticated;

comment on function public.pos_open_table_session(uuid, uuid) is
  'Abre la sesión de una mesa desde el POS, o devuelve la abierta (idempotente). No agrega participantes. Errores: AUTH_REQUIRED, INVALID_REQUEST, TABLE_NOT_FOUND, FORBIDDEN, TABLE_UNAVAILABLE, EMPLOYEE_NOT_FOUND.';

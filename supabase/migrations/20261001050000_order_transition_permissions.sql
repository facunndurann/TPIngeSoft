-- ============================================================
-- La máquina de estados de pedidos vuelve a ser solo datos.
--
-- 20260916200000_order_status_transitions dejó en `order_status_transitions`
-- la única lista de transiciones. Las versiones siguientes de
-- pos_transition_order (20260919020000 y 20261001020000) volvieron a escribir
-- los pares en un bloque VALUES, a deducir «revertir» del orden del enum y a
-- calcular el permiso con un `case` propio; el POS repetía las dos cosas en
-- `posActions` y `transitionPermission`. Eran cinco copias del mismo grafo, y
-- ningún test comparaba la función con la tabla.
--
-- Ahora cada fila dice también qué permiso exige, y la función lee la fila:
-- si no existe, el par no es válido; su permiso autoriza y su tipo decide los
-- timestamps. `posActions` espeja pares, tipos y permisos, y
-- supabase/tests/orders.integration.mjs compara los tres contra estas filas.
--
-- Único cambio de comportamiento: un par que ya era inválido se rechaza con
-- INVALID_TRANSITION aunque quien lo pide no tenga el permiso que el `case`
-- le atribuía (antes podía salir FORBIDDEN). Al comensal y a la cuenta
-- administrativa se les sigue respondiendo FORBIDDEN antes de mirar el par.
-- ============================================================

alter table public.order_status_transitions add column permission text;

-- Una fila por par, escrita entera: el `set not null` de abajo falla si alguna
-- transición quedara sin permiso.
update public.order_status_transitions tr set permission = v.permission
from (values
  ('submitted'::public.order_status, 'accepted'::public.order_status, 'orders.accept'),
  ('accepted', 'in_preparation', 'orders.prepare'),
  ('in_preparation', 'ready', 'orders.prepare'),
  ('ready', 'delivered', 'orders.deliver'),
  ('in_preparation', 'accepted', 'orders.revert'),
  ('ready', 'in_preparation', 'orders.revert'),
  ('delivered', 'ready', 'orders.revert'),
  ('submitted', 'cancelled', 'orders.cancel'),
  ('accepted', 'cancelled', 'orders.cancel'),
  ('in_preparation', 'cancelled', 'orders.cancel'),
  ('ready', 'cancelled', 'orders.cancel')
) as v(from_status, to_status, permission)
where tr.from_status = v.from_status and tr.to_status = v.to_status;

alter table public.order_status_transitions alter column permission set not null;

comment on column public.order_status_transitions.permission is
  'Permiso de role_permissions que exige la transición en la sucursal de la cuenta.';

create or replace function public.pos_transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
  bid uuid;
  step public.order_status_transitions;
  integration public.pos_integrations;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Filter authorization before returning existence/state information or locking.
  select o.* into target from orders o where o.id = p_order_id
    and public.can_read_session(o.session_id) for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select s.branch_id into bid from table_sessions s
    where s.id = target.session_id and s.restaurant_id = target.restaurant_id;
  -- El tablero es de empleados: la cuenta administrativa (que puede leer la
  -- sesión) no mueve pedidos, ni se entera de si el par pedido era válido.
  if bid is null or not exists(select 1 from profiles where id = auth.uid()) then
    raise exception 'FORBIDDEN'; end if;

  -- Repetir un cambio ya aplicado (doble toque, otro operador se adelantó) no
  -- hace nada, pero solo lo puede pedir quien podía llevar el pedido ahí.
  if target.status = p_status then
    if not exists(select 1 from order_status_transitions tr where tr.to_status = p_status
      and public.has_permission(target.restaurant_id, tr.permission, bid)) then
      raise exception 'FORBIDDEN'; end if;
    return target.id;
  end if;

  -- La tabla es la única lista de transiciones: la fila dice si el par es
  -- válido, qué permiso exige y de qué tipo es.
  select * into step from order_status_transitions
    where from_status = target.status and to_status = p_status;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  if not public.has_permission(target.restaurant_id, step.permission, bid) then
    raise exception 'FORBIDDEN'; end if;

  if target.status = 'submitted' and p_status = 'accepted' then
    select * into integration from pos_integrations where restaurant_id = target.restaurant_id for share;
    if found then
      if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
      if integration.type <> 'internal' then raise exception 'POS_UNSUPPORTED'; end if;
    end if;
  end if;

  -- Cada *_at registra cuándo el pedido entró a esa etapa en su recorrido actual:
  --   advance: sella la etapa destino con now().
  --   revert: borra las etapas posteriores al destino y conserva la del destino
  --           (volver a «en preparación» no reinicia preparing_at).
  --   cancel: sella cancelled_at y conserva hasta dónde llegó el pedido.
  update orders set status = p_status,
    accepted_at = case
      when step.kind = 'advance' and p_status = 'accepted' then now()
      else accepted_at end,
    preparing_at = case
      when step.kind = 'advance' and p_status = 'in_preparation' then now()
      when step.kind = 'revert' and p_status = 'accepted' then null
      else preparing_at end,
    ready_at = case
      when step.kind = 'advance' and p_status = 'ready' then now()
      when step.kind = 'revert' and p_status in ('accepted', 'in_preparation') then null
      else ready_at end,
    delivered_at = case
      when step.kind = 'advance' and p_status = 'delivered' then now()
      when step.kind = 'revert' then null
      else delivered_at end,
    cancelled_at = case when step.kind = 'cancel' then now() else cancelled_at end
  where id = target.id;

  update table_sessions set assigned_user_id = auth.uid() where id = target.session_id;
  perform public.record_pos_action(target.restaurant_id, bid, 'order.transition', target.id, target.session_id,
    jsonb_build_object('from', target.status, 'to', p_status));
  insert into integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'order.status_changed',
      jsonb_build_object('from', target.status, 'to', p_status, 'actorId', auth.uid()));
  return target.id;
end;
$$;

comment on function public.pos_transition_order(uuid, public.order_status) is
  'POS employees only; applies a transition listed in order_status_transitions with the permission its row requires. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';

-- transition_order es el alias histórico: su comentario decía que usaba la
-- tabla, y desde 20260919020000 no era cierto.
comment on function public.transition_order(uuid, public.order_status) is
  'Alias of pos_transition_order: POS employees only; applies a transition listed in order_status_transitions with the permission its row requires. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';

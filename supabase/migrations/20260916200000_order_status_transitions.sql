-- Máquina de estados de pedidos como datos.
--
-- transition_order tenía los pares permitidos en un bloque VALUES; un test los
-- comparaba con posActions (packages/shared/src/pos.ts) parseando el texto de
-- la migración (había que repuntar el import con cada migración nueva), y
-- "revertir" se deducía del orden de declaración del enum order_status. Ahora
-- esta tabla es la única fuente: transition_order la consulta y decide los
-- timestamps según kind, y supabase/tests/orders.integration.mjs compara
-- posActions contra sus filas.

create type public.order_transition_kind as enum ('advance', 'revert', 'cancel');

create table public.order_status_transitions (
  from_status public.order_status not null,
  to_status public.order_status not null,
  kind public.order_transition_kind not null,
  primary key (from_status, to_status)
);

insert into public.order_status_transitions (from_status, to_status, kind) values
  ('submitted', 'accepted', 'advance'),
  ('accepted', 'in_preparation', 'advance'),
  ('in_preparation', 'ready', 'advance'),
  ('ready', 'delivered', 'advance'),
  ('in_preparation', 'accepted', 'revert'),
  ('ready', 'in_preparation', 'revert'),
  ('delivered', 'ready', 'revert'),
  ('submitted', 'cancelled', 'cancel'),
  ('accepted', 'cancelled', 'cancel'),
  ('in_preparation', 'cancelled', 'cancel'),
  ('ready', 'cancelled', 'cancel');

-- Datos de referencia: lectura para usuarios autenticados, cambios solo por migración.
alter table public.order_status_transitions enable row level security;
create policy "authenticated read order status transitions" on public.order_status_transitions
  for select to authenticated using (true);
revoke all on public.order_status_transitions from anon;
revoke insert, update, delete, truncate on public.order_status_transitions from authenticated;

create or replace function public.transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
  transition_kind public.order_transition_kind;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into target from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if p_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if target.status = p_status then return target.id; end if;

  select kind into transition_kind from public.order_status_transitions
    where from_status = target.status and to_status = p_status;
  if not found then raise exception 'INVALID_TRANSITION'; end if;

  -- Aceptar pasa por el POS configurado (idempotente y con sus propios errores).
  if target.status = 'submitted' and p_status = 'accepted' then
    return public.dispatch_internal_order(target.id);
  end if;

  -- Cada *_at registra cuándo el pedido entró a esa etapa en su recorrido actual:
  --   advance: sella la etapa destino con now().
  --   revert: borra las etapas posteriores al destino y conserva la del destino
  --           (volver a "en preparación" no reinicia preparing_at).
  --   cancel: sella cancelled_at y conserva hasta dónde llegó el pedido.
  update public.orders set status = p_status,
    preparing_at = case
      when transition_kind = 'advance' and p_status = 'in_preparation' then now()
      when transition_kind = 'revert' and p_status = 'accepted' then null
      else preparing_at end,
    ready_at = case
      when transition_kind = 'advance' and p_status = 'ready' then now()
      when transition_kind = 'revert' and p_status in ('accepted', 'in_preparation') then null
      else ready_at end,
    delivered_at = case
      when transition_kind = 'advance' and p_status = 'delivered' then now()
      when transition_kind = 'revert' then null
      else delivered_at end,
    cancelled_at = case when transition_kind = 'cancel' then now() else cancelled_at end
  where id = target.id;

  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'order.status_changed',
      jsonb_build_object('from', target.status, 'to', p_status, 'actorId', auth.uid()));
  return target.id;
end;
$$;

comment on function public.transition_order(uuid, public.order_status) is
  'Tenant members only; applies a transition listed in order_status_transitions. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';

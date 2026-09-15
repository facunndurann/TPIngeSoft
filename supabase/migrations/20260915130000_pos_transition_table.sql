-- Máquina de estados de pedidos como tabla de pares (desde, hacia).
-- Espeja posActions en packages/shared/src/pos.ts; supabase/tests/edge.test.ts
-- lee este archivo y falla si las dos listas no coinciden.
--
-- Regla de timestamps: cada *_at registra cuándo el pedido entró a esa etapa en
-- su recorrido actual.
--   * Avanzar a una etapa la sella con now().
--   * Revertir borra las etapas posteriores al destino y conserva la del destino
--     (volver a "en preparación" no reinicia preparing_at).
--   * Cancelar solo sella cancelled_at y conserva hasta dónde llegó el pedido.
create or replace function public.transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
  reverting boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.* into target from public.orders o
    join public.table_sessions s on s.id = o.session_id and s.restaurant_id = o.restaurant_id
    where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if p_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if target.status = p_status then return target.id; end if;

  if (target.status, p_status) not in (values
    -- advance
    ('submitted'::public.order_status, 'accepted'::public.order_status),
    ('accepted', 'in_preparation'),
    ('in_preparation', 'ready'),
    ('ready', 'delivered'),
    -- revert
    ('in_preparation', 'accepted'),
    ('ready', 'in_preparation'),
    ('delivered', 'ready'),
    -- cancel
    ('submitted', 'cancelled'),
    ('accepted', 'cancelled'),
    ('in_preparation', 'cancelled'),
    ('ready', 'cancelled')
  ) then raise exception 'INVALID_TRANSITION'; end if;

  -- Aceptar pasa por el POS configurado (idempotente y con sus propios errores).
  if target.status = 'submitted' and p_status = 'accepted' then
    return public.dispatch_internal_order(target.id);
  end if;

  -- Los enums de Postgres se comparan por orden de declaración
  -- (submitted < accepted < in_preparation < ready < delivered < cancelled),
  -- así que ir a un valor menor es revertir. Cancelar nunca lo es.
  reverting := p_status < target.status;

  update public.orders set status = p_status,
    preparing_at = case
      when reverting and p_status < 'in_preparation' then null
      when not reverting and p_status = 'in_preparation' then now()
      else preparing_at end,
    ready_at = case
      when reverting and p_status < 'ready' then null
      when not reverting and p_status = 'ready' then now()
      else ready_at end,
    delivered_at = case
      when reverting then null
      when p_status = 'delivered' then now()
      else delivered_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = target.id;

  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'order.status_changed',
      jsonb_build_object('from', target.status, 'to', p_status, 'actorId', auth.uid()));
  return target.id;
end;
$$;

comment on function public.transition_order(uuid, public.order_status) is
  'Tenant members only; advance one stage, revert one stage, or cancel before delivery. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';

-- Limpia timestamps que la versión anterior dejaba desactualizados al revertir
-- (etapas posteriores al estado actual). Los cancelados conservan su historia.
update public.orders set
  preparing_at = case when status < 'in_preparation' then null else preparing_at end,
  ready_at = case when status < 'ready' then null else ready_at end,
  delivered_at = case when status < 'delivered' then null else delivered_at end
where status <> 'cancelled'
  and ((status < 'in_preparation' and preparing_at is not null)
    or (status < 'ready' and ready_at is not null)
    or (status < 'delivered' and delivered_at is not null));

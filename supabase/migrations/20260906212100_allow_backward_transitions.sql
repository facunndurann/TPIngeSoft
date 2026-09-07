create or replace function public.transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.* into target from public.orders o
    join public.table_sessions s on s.id = o.session_id and s.restaurant_id = o.restaurant_id
    where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if p_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if target.status = p_status then return target.id; end if;
  if target.status = 'submitted' and p_status = 'accepted' then
    return public.dispatch_internal_order(target.id);
  end if;
  if not (
    (target.status = 'accepted' and p_status = 'in_preparation')
    or (target.status = 'in_preparation' and p_status = 'ready')
    or (target.status = 'ready' and p_status = 'delivered')
    or (target.status in ('submitted', 'accepted', 'in_preparation', 'ready') and p_status = 'cancelled')
    or (target.status = 'in_preparation' and p_status = 'accepted')
    or (target.status = 'ready' and p_status = 'in_preparation')
    or (target.status = 'delivered' and p_status = 'ready')
  ) then raise exception 'INVALID_TRANSITION'; end if;
  update public.orders set status = p_status,
    preparing_at = case when p_status = 'in_preparation' then now() else preparing_at end,
    ready_at = case when p_status = 'ready' then now() else ready_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = target.id;
  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'order.status_changed',
      jsonb_build_object('from', target.status, 'to', p_status, 'actorId', auth.uid()));
  return target.id;
end;
$$;

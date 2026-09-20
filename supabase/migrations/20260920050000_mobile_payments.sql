-- MI-40: pago electrónico del saldo total, con confirmación de proveedor.
-- El navegador nunca manda el importe ni escribe payments directamente.

create function public.create_mobile_payment(p_session_id uuid, p_request_id uuid)
returns table(payment_id uuid, amount numeric, status public.payment_status)
language plpgsql security definer set search_path = public as $$
declare
  target public.table_sessions;
  diner_id uuid;
  methods public.payment_method[];
  due numeric;
  saved public.payments;
  reference text := 'mobile-request:' || p_request_id::text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  if exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'FORBIDDEN'; end if;

  select * into target from public.table_sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  select id into diner_id from public.session_participants
    where session_id=target.id and user_id=auth.uid();
  if diner_id is null then raise exception 'NOT_PARTICIPANT'; end if;
  select b.payment_methods into methods from public.tables t
    join public.branches b on b.id=t.branch_id and b.restaurant_id=t.restaurant_id
    where t.id=target.table_id and t.restaurant_id=target.restaurant_id;
  if not ('mobile'=any(methods)) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;

  -- Reintentar el mismo request devuelve exactamente el movimiento original.
  select * into saved from public.payments
    where restaurant_id=target.restaurant_id and method='mobile'
      and external_reference=reference;
  if found then return query select saved.id,saved.amount,saved.status; return; end if;
  if exists(select 1 from public.payments p where p.session_id=target.id
    and p.participant_id=diner_id and p.method='mobile' and p.status='pending')
    then raise exception 'PAYMENT_ALREADY_PENDING'; end if;

  select greatest(
    coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
      and o.restaurant_id=target.restaurant_id
      and o.status in ('accepted','in_preparation','ready','delivered')),0)
    - coalesce((select sum(p.amount) from public.payments p where p.session_id=target.id
      and p.restaurant_id=target.restaurant_id and p.status='approved'),0), 0
  ) into due;
  if due=0 then raise exception 'NOTHING_TO_PAY'; end if;

  insert into public.payments(restaurant_id,session_id,participant_id,amount,mode,method,status,external_reference)
  values(target.restaurant_id,target.id,diner_id,due,'full','mobile','pending',reference)
  returning * into saved;
  return query select saved.id,saved.amount,saved.status;
end;
$$;

-- Callback usado por la Edge Function. Sólo service_role puede ejecutarlo;
-- p_user_id proviene de auth.getUser(jwt), nunca del cuerpo de la petición.
create function public.resolve_mobile_payment(
  p_payment_id uuid, p_user_id uuid, p_status public.payment_status)
returns table(payment_id uuid, amount numeric, status public.payment_status)
language plpgsql security definer set search_path = public as $$
declare
  saved public.payments;
  target public.table_sessions;
  due numeric;
  final_status public.payment_status;
begin
  if p_payment_id is null or p_user_id is null or p_status not in ('approved','rejected')
    then raise exception 'INVALID_REQUEST'; end if;
  select * into saved from public.payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if saved.method <> 'mobile' then raise exception 'INVALID_REQUEST'; end if;
  if not exists(select 1 from public.session_participants where id=saved.participant_id
    and session_id=saved.session_id and user_id=p_user_id)
    then raise exception 'FORBIDDEN'; end if;
  if saved.status <> 'pending' then
    return query select saved.id,saved.amount,saved.status; return;
  end if;

  select * into target from public.table_sessions where id=saved.session_id for update;
  final_status := p_status;
  if target.status <> 'open' then final_status := 'rejected'; end if;
  if final_status='approved' then
    select greatest(
      coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
        and o.restaurant_id=target.restaurant_id
        and o.status in ('accepted','in_preparation','ready','delivered')),0)
      - coalesce((select sum(p.amount) from public.payments p where p.session_id=target.id
        and p.restaurant_id=target.restaurant_id and p.status='approved'),0), 0
    ) into due;
    if due=0 or saved.amount>due then final_status := 'rejected'; end if;
  end if;
  update public.payments set status=final_status,updated_at=now() where id=saved.id
    returning * into saved;
  return query select saved.id,saved.amount,saved.status;
end;
$$;

revoke all on function public.create_mobile_payment(uuid,uuid),
  public.resolve_mobile_payment(uuid,uuid,public.payment_status) from public,anon,authenticated;
grant execute on function public.create_mobile_payment(uuid,uuid) to authenticated,service_role;
grant execute on function public.resolve_mobile_payment(uuid,uuid,public.payment_status) to service_role;

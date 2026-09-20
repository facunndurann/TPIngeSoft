-- MI-42: pagos por ítems con trazabilidad. La relación conserva el snapshot
-- cobrado y permite reservar ítems durante un pago pendiente sin marcarlos como
-- cubiertos hasta que el proveedor lo apruebe.

create table public.payment_order_items (
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  primary key (payment_id, order_item_id)
);

create index payment_order_items_order_item_id_idx
  on public.payment_order_items(order_item_id);

alter table public.payment_order_items enable row level security;
create policy "session participants and payment readers read payment items"
on public.payment_order_items for select using (
  exists (
    select 1 from public.payments p
    where p.id = payment_id and (
      public.is_session_participant(p.session_id)
      or public.can_read_session(p.session_id, 'payments.read')
    )
  )
);

revoke all on public.payment_order_items from public, anon, authenticated;
grant select on public.payment_order_items to authenticated;

drop function public.create_mobile_payment(uuid,uuid,public.payment_mode);
create function public.create_mobile_payment(
  p_session_id uuid,
  p_request_id uuid,
  p_mode public.payment_mode default 'full',
  p_item_ids uuid[] default null
)
returns table(payment_id uuid, amount numeric, status public.payment_status)
language plpgsql security definer set search_path = public as $$
declare
  target public.table_sessions;
  diner_id uuid;
  methods public.payment_method[];
  due numeric;
  available_due numeric;
  payment_amount numeric;
  allocated_equal_parts integer;
  reserved_equal_amount numeric;
  remaining_parts integer;
  requested_count integer;
  saved_count integer;
  saved public.payments;
  reference text := 'mobile-request:' || p_request_id::text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null or p_mode is null
    or p_mode not in ('full','equal_split','custom')
    then raise exception 'INVALID_REQUEST'; end if;
  if p_mode = 'custom' and (
    coalesce(cardinality(p_item_ids),0)=0 or cardinality(p_item_ids)>100
  )
    then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
  if p_mode <> 'custom' and p_item_ids is not null
    then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
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

  select * into saved from public.payments
    where restaurant_id=target.restaurant_id and method='mobile'
      and external_reference=reference;
  if found then
    if saved.session_id <> target.id or saved.participant_id <> diner_id or saved.mode <> p_mode
      then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p_mode='custom' then
      select count(*) into saved_count from public.payment_order_items poi
        where poi.payment_id=saved.id;
      if saved_count <> cardinality(p_item_ids) or exists (
        select 1 from unnest(p_item_ids) requested(id)
        where not exists (
          select 1 from public.payment_order_items poi
          where poi.payment_id=saved.id and poi.order_item_id=requested.id
        )
      ) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    end if;
    return query select saved.id,saved.amount,saved.status; return;
  end if;
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

  if p_mode = 'equal_split' then
    if target.split_type <> 'equal' or target.split_equal_parts is null
      then raise exception 'INVALID_SPLIT'; end if;
    select count(*), coalesce(sum(p.amount) filter (where p.status='pending'),0)
      into allocated_equal_parts, reserved_equal_amount
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.mode='equal_split' and p.status in ('pending','approved');
    available_due := greatest(due - reserved_equal_amount, 0);
    if available_due=0 then raise exception 'PAYMENT_ALREADY_PENDING'; end if;
    remaining_parts := greatest(target.split_equal_parts - allocated_equal_parts, 1);
    payment_amount := ceil(available_due * 100 / remaining_parts) / 100;
  elsif p_mode = 'custom' then
    select count(*), coalesce(sum(oi.total_price),0)
      into requested_count, payment_amount
    from unnest(p_item_ids) requested(id)
    join public.order_items oi on oi.id=requested.id
    join public.orders o on o.id=oi.order_id
    where o.session_id=target.id and o.restaurant_id=target.restaurant_id
      and o.status in ('accepted','in_preparation','ready','delivered')
      and oi.total_price>0;
    if requested_count <> cardinality(p_item_ids)
      or requested_count <> (select count(distinct id) from unnest(p_item_ids) chosen(id))
      then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
    if exists (
      select 1 from public.payment_order_items poi
      join public.payments p on p.id=poi.payment_id
      where poi.order_item_id=any(p_item_ids) and p.status in ('pending','approved')
    ) then raise exception 'PAYMENT_ITEMS_UNAVAILABLE'; end if;
    if payment_amount > due then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  else
    payment_amount := due;
  end if;

  insert into public.payments(
    restaurant_id,session_id,participant_id,amount,mode,method,status,external_reference
  ) values(
    target.restaurant_id,target.id,diner_id,payment_amount,p_mode,'mobile','pending',reference
  ) returning * into saved;

  if p_mode='custom' then
    insert into public.payment_order_items(payment_id,order_item_id,amount)
    select saved.id,oi.id,oi.total_price
    from public.order_items oi where oi.id=any(p_item_ids);
  end if;
  return query select saved.id,saved.amount,saved.status;
end;
$$;

revoke all on function public.create_mobile_payment(uuid,uuid,public.payment_mode,uuid[])
  from public,anon,authenticated;
grant execute on function public.create_mobile_payment(uuid,uuid,public.payment_mode,uuid[])
  to authenticated,service_role;

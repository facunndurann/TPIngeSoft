-- ============================================================
-- MI-43: cerrar la división por porcentaje/ratio contra pagos reales.
--
-- La división por porcentajes ya se guardaba y se validaba (20260918000000 y
-- 20260919110000: las asignaciones suman 100 y son de comensales de la mesa).
-- Lo que faltaba es que sirviera para pagar: `create_mobile_payment` conocía
-- 'full', 'equal_split' y 'custom', así que una mesa dividida por porcentajes
-- solo podía pagar el total desde el celular.
--
-- La base del porcentaje es el TOTAL de la cuenta, no el pendiente. El
-- pendiente encoge cuando otro paga: con 40/60 sobre $100, si el de 60 paga,
-- el 40% del pendiente sería $16 en vez de los $40 que le tocan. El modo
-- `equal_split` sí reparte el pendiente porque sus partes son intercambiables;
-- un porcentaje está atado a una persona.
--
-- Nada de esto reimplementa la división: la fuente sigue siendo
-- `table_sessions.split_allocations`.
-- ============================================================

-- Importe que le toca a un comensal por su porcentaje, en pesos.
--
-- Reparte por resto mayor, igual que el navegador (packages/shared/src/split.ts):
-- las partes se truncan a centavos y los que sobran van a las fracciones más
-- altas, desempatando por id del comensal. Así la suma de todas las partes es
-- exactamente el total y el celular muestra el mismo centavo que se va a cobrar.
create function public.session_percentage_share(
  p_session_id uuid,
  p_participant_id uuid
)
returns numeric
language sql stable security definer set search_path = public
as $$
  with session_row as (
    select s.id, s.restaurant_id, s.split_type, s.split_allocations
    from public.table_sessions s
    where s.id = p_session_id and s.split_type = 'percentages'
  ),
  account as (
    select round(coalesce(sum(o.total_amount), 0) * 100)::bigint as cents
    from session_row s
    left join public.orders o
      on o.session_id = s.id and o.restaurant_id = s.restaurant_id
      and o.status in ('accepted', 'in_preparation', 'ready', 'delivered')
  ),
  shares as (
    select
      allocation.key::uuid as participant_id,
      floor(account.cents * (allocation.value)::numeric / 100) as cents,
      account.cents * (allocation.value)::numeric / 100
        - floor(account.cents * (allocation.value)::numeric / 100) as remainder
    from session_row s
    cross join account
    cross join lateral jsonb_each_text(s.split_allocations) as allocation
  ),
  ranked as (
    select participant_id, cents,
      row_number() over (order by remainder desc, participant_id) as position
    from shares
  ),
  leftover as (
    select (select cents from account) - coalesce(sum(cents), 0) as cents from ranked
  )
  select (ranked.cents + case when ranked.position <= (select cents from leftover) then 1 else 0 end)
    / 100::numeric
  from ranked
  where ranked.participant_id = p_participant_id;
$$;

comment on function public.session_percentage_share(uuid, uuid) is
  'MI-43: parte de un comensal según split_allocations, sobre el total de la cuenta '
  'y por resto mayor. Null si la sesión no divide por porcentajes o si no tiene asignación.';

-- Sólo la usan las RPC de pago, que ya corren como definer: nadie la llama suelta.
revoke all on function public.session_percentage_share(uuid, uuid)
  from public, anon, authenticated;

drop function public.create_mobile_payment(uuid, uuid, public.payment_mode, uuid[]);
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
  percentage_share numeric;
  settled_by_diner numeric;
  saved public.payments;
  reference text := 'mobile-request:' || p_request_id::text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null or p_mode is null
    or p_mode not in ('full','equal_split','percentage_split','custom')
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
  elsif p_mode = 'percentage_split' then
    if target.split_type <> 'percentages' then raise exception 'INVALID_SPLIT'; end if;
    percentage_share := public.session_percentage_share(target.id, diner_id);
    -- Sin asignación, o con 0%, no hay nada que este comensal deba pagar por
    -- porcentaje: la división es lo que hay que revisar, no el saldo.
    if coalesce(percentage_share, 0) <= 0 then raise exception 'INVALID_SPLIT'; end if;
    select coalesce(sum(p.amount),0) into settled_by_diner
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.participant_id=diner_id and p.status='approved';
    -- Lo que le falta de su parte, nunca más que lo que la mesa todavía debe:
    -- si otro pagó de más, el porcentaje no lo vuelve a cobrar.
    payment_amount := least(greatest(percentage_share - settled_by_diner, 0), due);
    if payment_amount <= 0 then raise exception 'NOTHING_TO_PAY'; end if;
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

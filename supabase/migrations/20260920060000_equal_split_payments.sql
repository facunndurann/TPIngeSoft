-- MI-41: cantidad explícita de partes iguales y pagos móviles parciales.
-- El cliente elige cuántas personas dividen; PostgreSQL decide el importe de
-- cada pago para que nunca se confíe en un monto calculado en el navegador.

alter table public.table_sessions add column split_equal_parts smallint;

-- Conserva las divisiones iguales creadas antes de esta migración. Una división
-- solo tiene sentido desde dos partes, aunque hoy haya un único teléfono unido.
update public.table_sessions s
set split_equal_parts = greatest(2, least(50, (
  select count(*) from public.session_participants p where p.session_id = s.id
)::integer))
where s.split_type = 'equal';

alter table public.table_sessions add constraint table_sessions_equal_parts_valid check (
  (split_type = 'equal' and split_equal_parts between 2 and 50)
  or (split_type <> 'equal' and split_equal_parts is null)
);

comment on column public.table_sessions.split_equal_parts is
  'Cantidad de partes cuando split_type=equal; no depende de teléfonos conectados.';

drop function public.update_session_split(uuid, public.split_type, jsonb);
create function public.update_session_split(
  p_session_id uuid,
  p_split_type public.split_type,
  p_allocations jsonb default '{}'::jsonb,
  p_equal_parts integer default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  allocations jsonb := coalesce(p_allocations, '{}'::jsonb);
  total numeric;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;
  if jsonb_typeof(allocations) <> 'object' then raise exception 'INVALID_SPLIT'; end if;

  if p_split_type = 'equal' then
    if allocations <> '{}'::jsonb or p_equal_parts is null
      or p_equal_parts < 2 or p_equal_parts > 50
      then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = p_equal_parts
    where id = p_session_id;
    return;
  end if;

  if p_equal_parts is not null then raise exception 'INVALID_SPLIT'; end if;
  if p_split_type <> 'percentages' then
    if allocations <> '{}'::jsonb then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = null
    where id = p_session_id;
    return;
  end if;

  if exists (
    select 1 from jsonb_each(allocations) a where jsonb_typeof(a.value) <> 'number'
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_each(allocations) a
    where (a.value)::numeric < 0 or (a.value)::numeric > 100
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_object_keys(allocations) as k(id)
    where k.id not in (
      select sp.id::text from public.session_participants sp where sp.session_id = p_session_id
    )
  ) then raise exception 'INVALID_SPLIT'; end if;
  select coalesce(sum((a.value)::numeric), 0) into total from jsonb_each(allocations) a;
  if total <> 100 then raise exception 'INVALID_SPLIT'; end if;

  update public.table_sessions set
    split_type = p_split_type,
    split_allocations = allocations,
    split_equal_parts = null
  where id = p_session_id;
end;
$$;

revoke all on function public.update_session_split(uuid, public.split_type, jsonb, integer)
  from public, anon;
grant execute on function public.update_session_split(uuid, public.split_type, jsonb, integer)
  to authenticated;

drop function public.create_mobile_payment(uuid, uuid);
create function public.create_mobile_payment(
  p_session_id uuid,
  p_request_id uuid,
  p_mode public.payment_mode default 'full'
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
  saved public.payments;
  reference text := 'mobile-request:' || p_request_id::text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null or p_mode is null
    or p_mode not in ('full','equal_split')
    then raise exception 'INVALID_REQUEST'; end if;
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
    -- La primera de las partes restantes absorbe el eventual centavo sobrante.
    payment_amount := ceil(available_due * 100 / remaining_parts) / 100;
  else
    payment_amount := due;
  end if;

  insert into public.payments(
    restaurant_id,session_id,participant_id,amount,mode,method,status,external_reference
  ) values(
    target.restaurant_id,target.id,diner_id,payment_amount,p_mode,'mobile','pending',reference
  ) returning * into saved;
  return query select saved.id,saved.amount,saved.status;
end;
$$;

revoke all on function public.create_mobile_payment(uuid,uuid,public.payment_mode)
  from public,anon,authenticated;
grant execute on function public.create_mobile_payment(uuid,uuid,public.payment_mode)
  to authenticated,service_role;

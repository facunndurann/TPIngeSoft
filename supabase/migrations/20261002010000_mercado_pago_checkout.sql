-- Checkout Pro: server-owned reservations, immutable receiver credentials,
-- leased preference creation and verified provider reconciliation.
-- Provider fields/statuses: https://www.mercadopago.com.ar/developers/en/reference/payments/_payments_id/get
-- Preferences: https://www.mercadopago.com.ar/developers/en/reference/preferences/_checkout_preferences/post
-- Local split/authorization rules preserve 20261001020000 + 20261001040000.

alter table public.payments
  add column provider_status text,
  add column provider_updated_at timestamptz,
  add column reconciliation_issue text,
  add column refunded_amount numeric(10,2) not null default 0
    check (refunded_amount >= 0 and refunded_amount <= amount);
comment on column public.payments.mp_payment_id is
  'Verified Mercado Pago payment identifier; external_reference remains the local request key.';
comment on column public.payments.refunded_amount is
  'Provider-verified amount refunded. Approved ledger credit is amount minus refunded_amount.';
create unique index payments_mp_payment_id_unique on public.payments(mp_payment_id)
  where mp_payment_id is not null;

create table private.mobile_checkouts (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  environment public.payment_provider_environment not null,
  access_token_secret_id uuid not null,
  webhook_secret_id uuid,
  currency_id text not null default 'ARS' check (currency_id = 'ARS'),
  checkout_state text not null default 'new'
    check (checkout_state in ('new','creating','ready','uncertain','failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  preference_id text unique,
  collector_id text,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.mobile_payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_payment_id text not null,
  provider_status text not null,
  provider_updated_at timestamptz not null,
  refunded_amount numeric(10,2) not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  unique(payment_id,provider_payment_id,provider_status,provider_updated_at,refunded_amount)
);
create table private.payment_rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  requests integer not null,
  primary key(user_id,action)
);
revoke all on private.mobile_checkouts, private.mobile_payment_events, private.payment_rate_limits
  from public,anon,authenticated;
grant all on private.mobile_checkouts, private.mobile_payment_events, private.payment_rate_limits
  to service_role;

-- Copy into independently encrypted Vault records. Updating/removing the current
-- restaurant configuration must not break notifications for money already sent.
create function private.snapshot_mobile_payment_credentials()
returns trigger language plpgsql security definer set search_path=public,private,vault as $$
declare receiver record; access_id uuid; webhook_id uuid;
begin
  if new.method <> 'mobile' or new.external_reference is null or new.external_reference not like 'mobile-request:%' then return new; end if;
  select c.environment,a.decrypted_secret as access_token,w.decrypted_secret as webhook_secret
    into receiver from private.payment_provider_credentials c
    join vault.decrypted_secrets a on a.id=c.access_token_secret_id
    left join vault.decrypted_secrets w on w.id=c.webhook_secret_id
    where c.restaurant_id=new.restaurant_id and c.provider='mercado_pago';
  if not found then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  access_id := vault.create_secret(receiver.access_token,'checkout:'||new.id::text||':access');
  if receiver.webhook_secret is not null then
    webhook_id := vault.create_secret(receiver.webhook_secret,'checkout:'||new.id::text||':webhook');
  end if;
  insert into private.mobile_checkouts(payment_id,environment,access_token_secret_id,webhook_secret_id)
    values(new.id,receiver.environment,access_id,webhook_id);
  return new;
end;
$$;
create trigger payments_snapshot_mobile_credentials after insert on public.payments
  for each row execute function private.snapshot_mobile_payment_credentials();
create function private.delete_mobile_checkout_secrets()
returns trigger language plpgsql security definer set search_path=private,vault as $$
begin
  delete from vault.secrets where id in(old.access_token_secret_id,old.webhook_secret_id);
  return old;
end;
$$;
create trigger mobile_checkout_delete_secrets after delete on private.mobile_checkouts
  for each row execute function private.delete_mobile_checkout_secrets();

-- Called only by the authenticated Edge gateway, never with a client-supplied user.
create function public.consume_payment_rate_limit(p_user_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public,private as $$
declare counter private.payment_rate_limits;
begin
  if p_user_id is null or p_action not in ('create','status') then raise exception 'INVALID_REQUEST'; end if;
  insert into private.payment_rate_limits(user_id,action,window_start,requests)
    values(p_user_id,p_action,clock_timestamp(),0) on conflict do nothing;
  select * into counter from private.payment_rate_limits
    where user_id=p_user_id and action=p_action for update;
  if counter.window_start <= clock_timestamp()-interval '1 minute' then
    update private.payment_rate_limits set window_start=clock_timestamp(),requests=1
      where user_id=p_user_id and action=p_action;
  elsif counter.requests>=20 then raise exception 'PAYMENT_RATE_LIMITED';
  else update private.payment_rate_limits set requests=requests+1
    where user_id=p_user_id and action=p_action;
  end if;
end;
$$;

-- Preserve existing split semantics, but reserve across every mode.
create or replace function public.create_mobile_payment(
  p_session_id uuid,
  p_request_id uuid,
  p_mode public.payment_mode default 'full',
  p_item_ids uuid[] default null
)
returns table(payment_id uuid, amount numeric, status public.payment_status)
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  diner_id uuid;
  methods public.payment_method[];
  due numeric;
  available_due numeric;
  payment_amount numeric;
  allocated_equal_parts integer;
  reserved_amount numeric;
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
  select id into diner_id from public.session_participants
    where session_id=target.id and user_id=auth.uid();
  if diner_id is null then raise exception 'NOT_PARTICIPANT'; end if;
  select b.payment_methods into methods from public.branches b
    where b.id=target.branch_id and b.restaurant_id=target.restaurant_id;

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
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  if not ('mobile'=any(methods)) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if exists(select 1 from public.payments p where p.session_id=target.id
    and p.participant_id=diner_id and p.method='mobile' and p.status='pending')
    then raise exception 'PAYMENT_ALREADY_PENDING'; end if;

  select greatest(
    coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
      and o.restaurant_id=target.restaurant_id
      and o.status in ('accepted','in_preparation','ready','delivered')),0)
    - coalesce((select sum(p.amount-p.refunded_amount) from public.payments p where p.session_id=target.id
      and p.restaurant_id=target.restaurant_id and p.status='approved'),0), 0
  ) into due;
  if due=0 then raise exception 'NOTHING_TO_PAY'; end if;
  select coalesce(sum(p.amount),0) into reserved_amount from public.payments p
    where p.session_id=target.id and p.status='pending';
  available_due := greatest(due-reserved_amount,0);
  if available_due=0 then raise exception 'PAYMENT_ALREADY_PENDING'; end if;

  if p_mode = 'equal_split' then
    if target.split_type <> 'equal' or target.split_equal_parts is null
      then raise exception 'INVALID_SPLIT'; end if;
    select count(*) into allocated_equal_parts
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.mode='equal_split' and p.status in ('pending','approved');
    if available_due=0 then raise exception 'PAYMENT_ALREADY_PENDING'; end if;
    remaining_parts := greatest(target.split_equal_parts - allocated_equal_parts, 1);
    payment_amount := ceil(available_due * 100 / remaining_parts) / 100;
  elsif p_mode = 'percentage_split' then
    if target.split_type <> 'percentages' then raise exception 'INVALID_SPLIT'; end if;
    percentage_share := public.session_percentage_share(target.id, diner_id);
    -- Sin asignación, o con 0%, no hay nada que este comensal deba pagar por
    -- porcentaje: la división es lo que hay que revisar, no el saldo.
    if coalesce(percentage_share, 0) <= 0 then raise exception 'INVALID_SPLIT'; end if;
    select coalesce(sum(p.amount-p.refunded_amount),0) into settled_by_diner
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.participant_id=diner_id and p.status='approved';
    -- Lo que le falta de su parte, nunca más que lo que la mesa todavía debe:
    -- si otro pagó de más, el porcentaje no lo vuelve a cobrar.
    payment_amount := least(greatest(percentage_share - settled_by_diner, 0), available_due);
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
    if payment_amount > available_due then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  else
    payment_amount := available_due;
  end if;

  perform public.consume_payment_rate_limit(auth.uid(),'create');
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

create or replace function public.pos_record_payment(
  p_session_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_participant_id uuid default null,
  p_external_reference text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  target_branch uuid;
  enabled_methods public.payment_method[];
  account_total numeric := 0;
  approved_total numeric := 0;
  pending_total numeric := 0;
  decided_mode public.payment_mode;
  payment_id uuid;
  normalized_reference text := nullif(btrim(p_external_reference), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_amount is null or p_method is null
    then raise exception 'INVALID_REQUEST'; end if;
  if p_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or p_amount <= 0 or p_amount <> round(p_amount, 2)
    then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  if normalized_reference is not null and length(normalized_reference) > 200
    then raise exception 'INVALID_REQUEST'; end if;

  -- Todas las registraciones de la sesión toman el mismo lock. Dos cajas no
  -- pueden acreditar simultáneamente más que el saldo disponible.
  select * into target from public.table_sessions
  where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;

  target_branch := target.branch_id;
  select b.payment_methods into enabled_methods
  from public.branches b
  where b.id = target.branch_id and b.restaurant_id = target.restaurant_id;
  if not exists(select 1 from public.profiles where id = auth.uid())
    or not public.has_permission(target.restaurant_id, 'payments.write', target_branch)
    then raise exception 'FORBIDDEN'; end if;
  if not (p_method = any(enabled_methods)) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  -- El pago mobile sólo se confirma desde la integración de la fase 10. El POS
  -- no puede fabricar una aprobación que el proveedor nunca confirmó.
  if p_method = 'mobile' then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  if p_participant_id is not null and not exists(
    select 1 from public.session_participants
    where id = p_participant_id and session_id = target.id
  ) then raise exception 'INVALID_PARTICIPANT'; end if;

  select coalesce(sum(total_amount), 0) into account_total
  from public.orders
  where session_id = target.id and restaurant_id = target.restaurant_id
    and status in ('accepted','in_preparation','ready','delivered');
  select coalesce(sum(amount-refunded_amount), 0) into approved_total
  from public.payments
  where session_id = target.id and restaurant_id = target.restaurant_id
    and status = 'approved';
  pending_total := greatest(account_total - approved_total, 0);
  if pending_total = 0 then raise exception 'NOTHING_TO_PAY'; end if;
  if p_amount > pending_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  if p_amount > pending_total-coalesce((select sum(p.amount) from public.payments p
    where p.session_id=target.id and p.status='pending'),0) then
    raise exception 'PAYMENT_ALREADY_PENDING';
  end if;

  -- Con la sesión bloqueada el pendiente no puede cambiar hasta el commit: si
  -- el cobro lo salda es la cuenta completa, y si no, un importe parcial.
  decided_mode := case when p_amount = pending_total then 'full' else 'custom' end;

  begin
    insert into public.payments(
      restaurant_id, session_id, participant_id, amount, mode, method,
      status, external_reference
    ) values (
      target.restaurant_id, target.id, p_participant_id, p_amount, decided_mode,
      p_method, 'approved', normalized_reference
    ) returning id into payment_id;
  exception when unique_violation then
    raise exception 'PAYMENT_REFERENCE_CONFLICT';
  end;

  perform public.record_pos_action(
    target.restaurant_id, target_branch, 'payment.recorded', null, target.id,
    jsonb_build_object(
      'paymentId', payment_id,
      'amount', p_amount,
      'method', p_method,
      'mode', decided_mode,
      'participantId', p_participant_id
    )
  );
  return payment_id;
end;
$$;

create or replace view public.session_bills with (security_invoker = true) as
select s.id as session_id,s.restaurant_id,
  coalesce(o.submitted_amount,0::numeric) as submitted_amount,
  coalesce(o.total_amount,0::numeric) as total_amount,
  coalesce(p.paid_amount,0::numeric) as paid_amount,
  greatest(coalesce(o.total_amount,0::numeric)-coalesce(p.paid_amount,0::numeric),0::numeric) as pending_amount,
  (coalesce(o.submitted_count,0)=0 and coalesce(o.total_amount,0::numeric)>0
    and coalesce(p.paid_amount,0::numeric)>=coalesce(o.total_amount,0::numeric)) as is_settled
from public.table_sessions s
left join lateral (
  select sum(total_amount) filter(where status='submitted') as submitted_amount,
    count(*) filter(where status='submitted') as submitted_count,
    sum(total_amount) filter(where status in ('accepted','in_preparation','ready','delivered')) as total_amount
    from public.orders where session_id=s.id and restaurant_id=s.restaurant_id
) o on true
left join lateral (
  select sum(amount-refunded_amount) as paid_amount from public.payments
    where session_id=s.id and restaurant_id=s.restaurant_id and status='approved'
) p on true
where public.is_session_participant(s.id) or public.can_read_session(s.id,'payments.read');

-- This service-only context is never returned wholesale to a browser.
create function public.resolve_payment_provider_for_payment(p_payment_id uuid,p_user_id uuid default null)
returns table(
  payment_id uuid,amount numeric,status public.payment_status,currency_id text,
  external_reference text,environment public.payment_provider_environment,
  access_token text,webhook_secret text,checkout_state text,lease_token uuid,
  preference_id text,checkout_url text,collector_id text,mp_payment_id text,provider_status text,
  session_id uuid,restaurant_id uuid,branch_id uuid,qr_token text
)
language plpgsql stable security definer set search_path=public,private,vault as $$
begin
  if p_user_id is not null and not exists(
    select 1 from public.payments p join public.session_participants sp on sp.id=p.participant_id
    where p.id=p_payment_id and sp.user_id=p_user_id and sp.session_id=p.session_id
  ) then raise exception 'FORBIDDEN'; end if;
  return query select p.id,p.amount,p.status,c.currency_id,p.id::text,c.environment,
    a.decrypted_secret,w.decrypted_secret,c.checkout_state,c.lease_token,c.preference_id,c.checkout_url,
    c.collector_id,p.mp_payment_id,p.provider_status,p.session_id,p.restaurant_id,s.branch_id,t.qr_token
    from public.payments p join private.mobile_checkouts c on c.payment_id=p.id
    join public.table_sessions s on s.id=p.session_id
    left join public.tables t on t.id=s.table_id
    join vault.decrypted_secrets a on a.id=c.access_token_secret_id
    left join vault.decrypted_secrets w on w.id=c.webhook_secret_id
    where p.id=p_payment_id and p.method='mobile';
end;
$$;

create function public.claim_mobile_checkout(p_payment_id uuid,p_user_id uuid)
returns table(
  payment_id uuid,amount numeric,status public.payment_status,currency_id text,
  external_reference text,environment public.payment_provider_environment,
  access_token text,webhook_secret text,checkout_state text,lease_token uuid,
  preference_id text,checkout_url text,collector_id text,mp_payment_id text,provider_status text,
  session_id uuid,restaurant_id uuid,branch_id uuid,qr_token text
)
language plpgsql security definer set search_path=public,private as $$
declare saved public.payments; checkout private.mobile_checkouts; target public.table_sessions;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into saved from public.payments where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into target from public.table_sessions where id=saved.session_id for update;
  perform 1 from public.payments where id=p_payment_id for update;
  if not exists(select 1 from public.session_participants sp where sp.id=saved.participant_id
    and sp.session_id=saved.session_id and sp.user_id=p_user_id) then raise exception 'FORBIDDEN'; end if;
  select * into checkout from private.mobile_checkouts where mobile_checkouts.payment_id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if checkout.checkout_state='new' then
    if saved.status<>'pending' then raise exception 'INVALID_PAYMENT_STATUS'; end if;
    if target.status<>'open' then raise exception 'SESSION_CLOSED'; end if;
    update private.mobile_checkouts set checkout_state='creating',lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=now()
      where mobile_checkouts.payment_id=p_payment_id;
  elsif checkout.checkout_state='creating' then
    if checkout.lease_expires_at>clock_timestamp() then raise exception 'CHECKOUT_IN_PROGRESS'; end if;
    -- Expiry says nothing about the remote result. Search/adopt only; no new POST.
    update private.mobile_checkouts set checkout_state='uncertain',updated_at=now()
      where mobile_checkouts.payment_id=p_payment_id;
  end if;
  return query select * from public.resolve_payment_provider_for_payment(p_payment_id,p_user_id);
end;
$$;

create function public.complete_mobile_checkout(
  p_payment_id uuid,p_lease_token uuid,p_preference_id text,p_checkout_url text,p_collector_id text
)
returns void language plpgsql security definer set search_path=public,private as $$
declare checkout private.mobile_checkouts;
begin
  if p_lease_token is null or nullif(p_preference_id,'') is null
    or length(p_preference_id)>200 or p_checkout_url is null or p_checkout_url !~ '^https://'
    or length(p_checkout_url)>2048 or p_collector_id is null or p_collector_id !~ '^[0-9]+$'
    then raise exception 'INVALID_REQUEST'; end if;
  select * into checkout from private.mobile_checkouts where payment_id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if checkout.lease_token is distinct from p_lease_token then raise exception 'CHECKOUT_LEASE_MISMATCH'; end if;
  if checkout.checkout_state='ready' then
    if checkout.preference_id<>p_preference_id or checkout.collector_id<>p_collector_id
      then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return;
  end if;
  if checkout.checkout_state not in ('creating','uncertain') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
  update private.mobile_checkouts set preference_id=p_preference_id,checkout_url=p_checkout_url,
    collector_id=p_collector_id,checkout_state='ready',lease_expires_at=null,updated_at=now()
    where payment_id=p_payment_id;
end;
$$;

create function public.fail_mobile_checkout(p_payment_id uuid,p_lease_token uuid,p_definitive boolean default false)
returns void language plpgsql security definer set search_path=public,private as $$
declare checkout private.mobile_checkouts; target_session uuid;
begin
  select session_id into target_session from public.payments where id=p_payment_id;
  perform 1 from public.table_sessions where id=target_session for update;
  perform 1 from public.payments where id=p_payment_id for update;
  select * into checkout from private.mobile_checkouts where payment_id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if checkout.lease_token is distinct from p_lease_token or p_lease_token is null
    then raise exception 'CHECKOUT_LEASE_MISMATCH'; end if;
  if checkout.checkout_state='ready' then return; end if;
  if checkout.checkout_state='failed' then return; end if;
  update private.mobile_checkouts set checkout_state=case when p_definitive then 'failed' else 'uncertain' end,
    lease_expires_at=null,updated_at=now() where payment_id=p_payment_id;
  -- Only a definitive API rejection BEFORE creating a preference releases funds.
  if p_definitive then update public.payments set status='cancelled',updated_at=now()
    where id=p_payment_id and status='pending' and mp_payment_id is null; end if;
end;
$$;

create function public.apply_mercado_pago_payment(
  p_payment_id uuid,p_provider_payment_id text,p_external_reference text,p_amount numeric,
  p_currency_id text,p_provider_status text,p_provider_updated_at timestamptz,p_refunded_amount numeric default 0
)
returns table(payment_id uuid,amount numeric,status public.payment_status)
language plpgsql security definer set search_path=public,private as $$
declare
  saved public.payments; checkout private.mobile_checkouts; target public.table_sessions;
  decided public.payment_status; issue text; event_outcome text := 'applied'; due numeric;
begin
  if p_provider_payment_id is null or p_provider_payment_id !~ '^[0-9]+$'
    or p_provider_updated_at is null or nullif(p_provider_status,'') is null
    or length(p_provider_status)>80 or p_refunded_amount is null or p_amount is null
    or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_refunded_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    then raise exception 'INVALID_REQUEST'; end if;
  select * into saved from public.payments where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  -- All paths share session -> payment order to avoid deadlocks with new reservations.
  select * into target from public.table_sessions where id=saved.session_id for update;
  select * into saved from public.payments where id=p_payment_id for update;
  select * into checkout from private.mobile_checkouts where mobile_checkouts.payment_id=p_payment_id;
  if not found or saved.method<>'mobile' then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if p_external_reference is distinct from saved.id::text or p_amount<>saved.amount
    or p_currency_id is distinct from checkout.currency_id or p_refunded_amount<0
    or p_refunded_amount>saved.amount or p_refunded_amount<>round(p_refunded_amount,2)
    then raise exception 'PAYMENT_PROVIDER_MISMATCH'; end if;

  if exists(select 1 from public.payments p where p.mp_payment_id=p_provider_payment_id and p.id<>saved.id)
    then raise exception 'PAYMENT_PROVIDER_MISMATCH'; end if;

  -- Capture provider observations without exposing notification payloads or secrets.
  insert into private.mobile_payment_events(payment_id,provider_payment_id,provider_status,
    provider_updated_at,refunded_amount,outcome)
    values(saved.id,p_provider_payment_id,p_provider_status,p_provider_updated_at,p_refunded_amount,'received')
    on conflict do nothing;
  if not found then return query select saved.id,saved.amount,saved.status; return; end if;

  if saved.mp_payment_id=p_provider_payment_id and saved.provider_updated_at>p_provider_updated_at then
    event_outcome := 'ignored_stale';
  elsif saved.mp_payment_id=p_provider_payment_id and p_refunded_amount<saved.refunded_amount then
    event_outcome := 'ignored_regression';
  elsif saved.mp_payment_id is not null and saved.mp_payment_id<>p_provider_payment_id
    and (saved.status='approved' or saved.refunded_amount>0 or saved.provider_status in ('refunded','charged_back')) then
    -- Checkout Pro can produce several attempts. Never overwrite a collected
    -- payment with another ID, and preserve evidence of a second collection.
    event_outcome := 'additional_provider_payment';
    if p_provider_status in ('approved','refunded','charged_back') then
      update public.payments set reconciliation_issue='MULTIPLE_PROVIDER_PAYMENTS',updated_at=now() where id=saved.id;
    end if;
  else
    decided := saved.status;
    issue := saved.reconciliation_issue;
    if p_provider_status='approved' then
      if saved.provider_status in ('refunded','charged_back') and saved.mp_payment_id=p_provider_payment_id then
        event_outcome := 'ignored_terminal';
      else
        decided := 'approved';
        if p_refunded_amount>0 then issue := 'PARTIAL_REFUND_REVIEW'; end if;
        select greatest(coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
          and o.status in ('accepted','in_preparation','ready','delivered')),0)
          -coalesce((select sum(p.amount-p.refunded_amount) from public.payments p where p.session_id=target.id
            and p.id<>saved.id and p.status='approved'),0),0) into due;
        if target.status<>'open' then issue := 'APPROVED_AFTER_SESSION_CLOSED';
        elsif saved.amount-p_refunded_amount>due then issue := 'APPROVED_EXCEEDS_BALANCE'; end if;
      end if;
    elsif p_provider_status in ('refunded','charged_back') then
      decided := 'cancelled';
      issue := case when p_provider_status='charged_back' then 'CHARGEBACK_REVIEW' else 'REFUND_REVIEW' end;
    elsif p_provider_status in ('rejected','cancelled') then
      if saved.status='approved' then issue := 'UNEXPECTED_PROVIDER_TRANSITION';
      else decided := case when p_provider_status='rejected' then 'rejected'::public.payment_status else 'cancelled'::public.payment_status end; end if;
    elsif p_provider_status in ('pending','in_process','authorized') then
      if saved.status='approved' and saved.mp_payment_id=p_provider_payment_id then event_outcome := 'ignored_regression';
      elsif saved.status in ('rejected','cancelled') and saved.mp_payment_id=p_provider_payment_id then event_outcome := 'ignored_regression';
      else decided := 'pending'; end if;
    elsif p_provider_status='in_mediation' then
      issue := 'PAYMENT_IN_MEDIATION';
    else
      issue := 'UNSUPPORTED_PROVIDER_STATUS';
    end if;
    if event_outcome='applied' then
      update public.payments set mp_payment_id=p_provider_payment_id,provider_status=p_provider_status,
        provider_updated_at=p_provider_updated_at,status=decided,refunded_amount=p_refunded_amount,
        reconciliation_issue=issue,updated_at=now() where id=saved.id;
    end if;
  end if;
  update private.mobile_payment_events set outcome=event_outcome
    where mobile_payment_events.payment_id=saved.id and provider_payment_id=p_provider_payment_id
      and provider_status=p_provider_status and provider_updated_at=p_provider_updated_at and refunded_amount=p_refunded_amount;
  return query select p.id,p.amount,p.status from public.payments p where p.id=saved.id;
end;
$$;

-- A pending/collected provider checkout commits the bill that its amount was
-- calculated from. Preparation/delivery transitions and newly added orders stay valid.
create function private.protect_checkout_order()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare committed boolean;
begin
  if old.status not in ('accepted','in_preparation','ready','delivered') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  perform 1 from public.table_sessions where id=old.session_id for update;
  select exists(select 1 from public.payments p join private.mobile_checkouts c on c.payment_id=p.id
    where p.session_id=old.session_id and p.status in ('pending','approved'))
    into committed;
  if committed then
    if tg_op='DELETE' then raise exception 'PAYMENT_COMMITTED_ORDER'; end if;
    if new.total_amount<old.total_amount or new.status not in ('accepted','in_preparation','ready','delivered')
      or new.session_id<>old.session_id then raise exception 'PAYMENT_COMMITTED_ORDER'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger orders_protect_checkout before update or delete on public.orders
  for each row execute function private.protect_checkout_order();


-- Price/quantity/order identity of committed lines is immutable. Reassignment
-- between diners is permitted because it does not change the charged snapshot.
create function private.protect_checkout_order_item()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare target_session uuid;
begin
  select o.session_id into target_session from public.orders o where o.id=old.order_id
    and o.status in ('accepted','in_preparation','ready','delivered');
  if target_session is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  perform 1 from public.table_sessions where id=target_session for update;
  if exists(select 1 from public.payments p join private.mobile_checkouts c on c.payment_id=p.id
    where p.session_id=target_session and p.status in ('pending','approved')) then
    if tg_op='DELETE' then raise exception 'PAYMENT_COMMITTED_ORDER'; end if;
    if new.total_price<>old.total_price or new.quantity<>old.quantity or new.base_price<>old.base_price
      or new.order_id<>old.order_id then raise exception 'PAYMENT_COMMITTED_ORDER'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger order_items_protect_checkout before update or delete on public.order_items
  for each row execute function private.protect_checkout_order_item();
revoke all on function private.protect_checkout_order_item() from public,anon,authenticated;

revoke all on function public.consume_payment_rate_limit(uuid,text),
  public.resolve_payment_provider_for_payment(uuid,uuid),public.claim_mobile_checkout(uuid,uuid),
  public.complete_mobile_checkout(uuid,uuid,text,text,text),public.fail_mobile_checkout(uuid,uuid,boolean),
  public.apply_mercado_pago_payment(uuid,text,text,numeric,text,text,timestamptz,numeric)
  from public,anon,authenticated;
grant execute on function public.consume_payment_rate_limit(uuid,text),
  public.resolve_payment_provider_for_payment(uuid,uuid),public.claim_mobile_checkout(uuid,uuid),
  public.complete_mobile_checkout(uuid,uuid,text,text,text),public.fail_mobile_checkout(uuid,uuid,boolean),
  public.apply_mercado_pago_payment(uuid,text,text,numeric,text,text,timestamptz,numeric)
  to service_role;
revoke all on function private.snapshot_mobile_payment_credentials(),private.delete_mobile_checkout_secrets(),
  private.protect_checkout_order() from public,anon,authenticated;

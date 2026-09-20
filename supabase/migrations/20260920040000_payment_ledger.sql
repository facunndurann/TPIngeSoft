-- ============================================================
-- MI-49: registro de pagos relacionado con la cuenta.
--
-- La cuenta sigue siendo un agregado de pedidos; un pago es un movimiento
-- independiente. `session_bills` acredita exclusivamente movimientos approved.
-- Los cobros presenciales se registran mediante una RPC transaccional para que
-- el cliente nunca pueda elegir restaurante, sucursal, estado o saldo.
-- ============================================================

alter table public.payments
  add column method public.payment_method,
  add column external_reference text;

-- Compatibilidad con los pagos históricos, que sólo distinguían los de MP.
update public.payments
set method = case
  when mp_payment_id is not null then 'mobile'::public.payment_method
  else 'external'::public.payment_method
end,
external_reference = mp_payment_id
where method is null;

alter table public.payments
  alter column method set not null,
  add constraint payments_external_reference_length
    check (external_reference is null or length(external_reference) <= 200);

comment on column public.payments.method is
  'Medio concreto usado para pagar. Es independiente de mode, que describe cómo se dividió la cuenta.';
comment on column public.payments.external_reference is
  'Identificador opcional del proveedor, transferencia, recibo o terminal. No contiene credenciales.';
comment on column public.payments.mp_payment_id is
  'Compatibilidad histórica. Las integraciones nuevas deben usar external_reference.';

create index payments_session_created_idx
  on public.payments(session_id, created_at desc);
create unique index payments_external_reference_unique
  on public.payments(restaurant_id, method, external_reference)
  where external_reference is not null;

-- Cobrar es distinto de ver importes. Mozo y caja pueden registrar un cobro;
-- todos los roles de conducción heredan la misma capacidad operativa.
insert into public.role_permissions(role, permission)
select role::public.member_role, 'payments.write'
from unnest(array['owner','manager','supervisor','waiter','cashier','staff']) role
on conflict do nothing;

create function public.pos_record_payment(
  p_session_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_mode public.payment_mode default 'full',
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
  payment_id uuid;
  normalized_reference text := nullif(btrim(p_external_reference), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_amount is null or p_method is null or p_mode is null
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

  select t.branch_id, b.payment_methods into target_branch, enabled_methods
  from public.tables t
  join public.branches b on b.id = t.branch_id and b.restaurant_id = t.restaurant_id
  where t.id = target.table_id and t.restaurant_id = target.restaurant_id;
  if target_branch is null then raise exception 'TABLE_NOT_FOUND'; end if;
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
  select coalesce(sum(amount), 0) into approved_total
  from public.payments
  where session_id = target.id and restaurant_id = target.restaurant_id
    and status = 'approved';
  pending_total := greatest(account_total - approved_total, 0);
  if pending_total = 0 then raise exception 'NOTHING_TO_PAY'; end if;
  if p_amount > pending_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;

  begin
    insert into public.payments(
      restaurant_id, session_id, participant_id, amount, mode, method,
      status, external_reference
    ) values (
      target.restaurant_id, target.id, p_participant_id, p_amount, p_mode,
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
      'mode', p_mode,
      'participantId', p_participant_id
    )
  );
  return payment_id;
end;
$$;

revoke all on function public.pos_record_payment(
  uuid,numeric,public.payment_method,public.payment_mode,uuid,text
) from public, anon;
grant execute on function public.pos_record_payment(
  uuid,numeric,public.payment_method,public.payment_mode,uuid,text
) to authenticated;

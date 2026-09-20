-- ============================================================
-- MI-38 / MI-46 / MI-47: el comensal avisa que quiere la cuenta o que lo cobren
-- en la mesa, y el salón ve esas mesas y marca la solicitud como atendida.
--
-- El estado vive en las dos columnas que MI-63 ya había dejado en la sesión
-- (bill_requested_at, in_person_payment_requested_at): son las que lee el plano
-- para pintar la mesa. Acá se agregan las dos operaciones que faltaban —pedir y
-- atender— y las solicitudes quedan expuestas en la vista de mesas activas.
--
-- Una solicitud es un momento, no una fila: mientras la columna tiene fecha hay
-- pedido pendiente, y atenderla la vuelve a null. Volver a tocar el botón no
-- duplica nada porque la hora original se conserva (el mozo necesita saber
-- desde cuándo esperan, no cuántas veces insistieron).
-- ============================================================

create type public.session_request_kind as enum ('bill', 'in_person_payment');

-- Atender una mesa que llamó es del salón y de la caja; cocina no opera el salón.
insert into public.role_permissions
select r::public.member_role, 'sessions.attend'
from unnest(array['owner', 'manager', 'supervisor', 'staff', 'waiter', 'cashier']) r
on conflict do nothing;

-- ---------- Comensal: pedir ----------
create function public.request_session_service(
  p_session_id uuid,
  p_kind public.session_request_kind
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  requested timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_kind is null then raise exception 'INVALID_REQUEST'; end if;
  -- Pedir la cuenta es del comensal. Un empleado atiende la mesa desde el POS,
  -- igual que no puede sumarse a una sesión por QR (join_table_session).
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'FORBIDDEN'; end if;

  -- Se bloquea la fila: dos comensales tocando el botón a la vez dejan una sola
  -- solicitud, con la hora del primero.
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  requested := case p_kind
    when 'bill' then target.bill_requested_at
    else target.in_person_payment_requested_at end;
  -- Ya hay una solicitud viva de este tipo: se devuelve la misma hora sin
  -- escribir, así el plano tampoco se despierta por un toque repetido.
  if requested is not null then return requested; end if;

  requested := now();
  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then requested else bill_requested_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then requested else in_person_payment_requested_at end
  where id = target.id;
  return requested;
end;
$$;

comment on function public.request_session_service(uuid, public.session_request_kind) is
  'MI-38/MI-46: un comensal de la mesa pide la cuenta o cobro presencial. Idempotente: '
  'devuelve la hora de la solicitud viva. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, '
  'SESSION_NOT_FOUND, SESSION_CLOSED, NOT_PARTICIPANT.';

-- ---------- Salón: atender ----------
create function public.pos_resolve_session_request(
  p_session_id uuid,
  p_kind public.session_request_kind
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  bid uuid;
  requested timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_kind is null then raise exception 'INVALID_REQUEST'; end if;
  -- Igual que el cierre: la autorización se resuelve antes de informar si la
  -- sesión existe, y antes de bloquear la fila.
  if not exists (select 1 from profiles where id = auth.uid())
    or not public.can_read_session(p_session_id, 'sessions.attend')
    then raise exception 'FORBIDDEN'; end if;

  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select branch_id into bid from public.tables
    where id = target.table_id and restaurant_id = target.restaurant_id;
  if bid is null or not public.has_permission(target.restaurant_id, 'sessions.attend', bid)
    then raise exception 'FORBIDDEN'; end if;

  requested := case p_kind
    when 'bill' then target.bill_requested_at
    else target.in_person_payment_requested_at end;
  -- Nada que atender: sin fila de auditoría, para que dos mozos tocando el
  -- mismo botón no registren dos atenciones de una sola solicitud.
  if requested is null then return null; end if;

  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then null else bill_requested_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then null else in_person_payment_requested_at end,
    -- Atender la mesa es operarla: queda como responsable quien fue.
    assigned_user_id = auth.uid()
  where id = target.id;

  perform public.record_pos_action(
    target.restaurant_id, bid, 'session.request_attended', null, target.id,
    jsonb_build_object('kind', p_kind, 'requestedAt', requested));
  return requested;
end;
$$;

comment on function public.pos_resolve_session_request(uuid, public.session_request_kind) is
  'MI-47: marca atendida la solicitud de una mesa y la audita. Devuelve la hora que tenía la '
  'solicitud, o null si no había ninguna. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, '
  'SESSION_NOT_FOUND.';

revoke all on function public.request_session_service(uuid, public.session_request_kind),
  public.pos_resolve_session_request(uuid, public.session_request_kind) from public, anon;
grant execute on function public.request_session_service(uuid, public.session_request_kind),
  public.pos_resolve_session_request(uuid, public.session_request_kind) to authenticated;

-- ---------- Mesas activas ----------
-- Dos cambios sobre la vista:
--
-- 1. Expone las solicitudes, así la lista de mesas que llamaron (MI-47) sale de
--    la misma lectura que ya arma la tarjeta.
-- 2. `session_bills` solo devuelve fila a quien tiene `payments.read`, y el join
--    era interno: un mozo (que no lo tiene) no veía **ninguna** mesa activa.
--    Pasa a left join, con los importes en 0 para quien no puede leerlos; la
--    pantalla ya los oculta por permiso.
drop view if exists public.pos_open_sessions;

create view public.pos_open_sessions with (security_invoker = true) as
select s.id, s.restaurant_id, s.table_id, s.opened_at,
  t.label as table_label,
  t.branch_id,
  b.name as branch_name,
  coalesce(p.names, '{}') as participant_names,
  coalesce(bill.submitted_amount, 0::numeric) as submitted_amount,
  coalesce(bill.total_amount, 0::numeric) as total_amount,
  coalesce(bill.paid_amount, 0::numeric) as paid_amount,
  coalesce(bill.pending_amount, 0::numeric) as pending_amount,
  s.bill_requested_at,
  s.in_person_payment_requested_at,
  k.tickets as kitchen_tickets
from public.table_sessions s
join public.tables t on t.id = s.table_id
join public.branches b on b.id = t.branch_id
left join public.session_bills bill on bill.session_id = s.id
left join lateral (
  select array_agg(sp.display_name order by sp.joined_at) as names
  from public.session_participants sp
  where sp.session_id = s.id
) p on true
left join lateral (
  select count(*)::integer as tickets
  from public.orders o
  where o.session_id = s.id
    and exists (
      select 1 from public.order_status_transitions tr
      where tr.from_status = o.status and tr.kind = 'advance'
    )
) k on true
where s.status = 'open';

revoke all on public.pos_open_sessions from public, anon;
grant select on public.pos_open_sessions to authenticated;

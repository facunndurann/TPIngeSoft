-- ============================================================
-- MI-38 / MI-46: la mesa se tiene que enterar de que la atendieron.
--
-- Hasta acá atender una solicitud solo la borraba: del lado del comensal el
-- aviso desaparecía sin explicación, justo cuando lo único que quiere saber es
-- si ya puede irse. La atención pasa a ser un momento guardado, no un borrado.
--
-- Vive en la sesión y no en el cliente a propósito: el comensal puede tener la
-- app cerrada, estar mirando la carta o entrar desde otro teléfono, y el aviso
-- tiene que seguir ahí. Un pedido nuevo del mismo tipo limpia la confirmación
-- vieja, así nunca se muestran juntos «estás esperando» y «ya te atendieron».
-- ============================================================

alter table public.table_sessions
  add column bill_attended_at timestamptz,
  add column in_person_payment_attended_at timestamptz;

comment on column public.table_sessions.bill_attended_at is
  'Momento en que el salón dio por entregada la cuenta que la mesa pidió.';
comment on column public.table_sessions.in_person_payment_attended_at is
  'Momento en que el salón dio por cobrada la mesa en persona. El pago todavía no '
  'se registra como tal: eso llega con MI-49.';

create or replace function public.request_session_service(
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
  -- Pedir de nuevo borra la confirmación anterior: lo último que pasó es que la
  -- mesa volvió a llamar.
  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then requested else bill_requested_at end,
    bill_attended_at = case
      when p_kind = 'bill' then null else bill_attended_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then requested else in_person_payment_requested_at end,
    in_person_payment_attended_at = case
      when p_kind = 'in_person_payment' then null else in_person_payment_attended_at end
  where id = target.id;
  return requested;
end;
$$;

create or replace function public.pos_resolve_session_request(
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
  -- mismo botón no registren dos atenciones de una sola solicitud. Tampoco se
  -- pisa la confirmación que ya está viendo la mesa.
  if requested is null then return null; end if;

  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then null else bill_requested_at end,
    bill_attended_at = case
      when p_kind = 'bill' then now() else bill_attended_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then null else in_person_payment_requested_at end,
    in_person_payment_attended_at = case
      when p_kind = 'in_person_payment' then now() else in_person_payment_attended_at end,
    -- Atender la mesa es operarla: queda como responsable quien fue.
    assigned_user_id = auth.uid()
  where id = target.id;

  perform public.record_pos_action(
    target.restaurant_id, bid, 'session.request_attended', null, target.id,
    jsonb_build_object('kind', p_kind, 'requestedAt', requested));
  return requested;
end;
$$;

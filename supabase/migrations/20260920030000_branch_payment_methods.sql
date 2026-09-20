-- ============================================================
-- MI-48: cada local decide con qué se le puede pagar.
--
-- Va en la sucursal y no en el restaurante porque todo lo operativo ya está
-- alcanzado por sucursal (mesas, sesiones, permisos): una cadena puede tener
-- posnet en el centro y solo efectivo en la sucursal del parque.
--
-- Es un array en `branches` y no una tabla aparte por dos razones: guardar el
-- conjunto entero es un solo update (no hay estado a medias que reconciliar), y
-- el comensal ya lee su sucursal para abrir la carta, así que los medios le
-- llegan sin una consulta más. El orden y los repetidos no importan: quien lo
-- lee recorre el catálogo (packages/shared/src/payments.ts), no el array.
--
-- `payment_method` es *con qué se paga*, distinto de `payment_mode`
-- ('full', 'own', 'equal_split', 'custom'), que es *cuánto paga cada uno*.
-- ============================================================

create type public.payment_method as enum ('mobile', 'in_person', 'external');

comment on type public.payment_method is
  'Medios con los que un local acepta que se salde la cuenta: mobile = pago '
  'electrónico desde la app (MI-40), in_person = un mozo cobra en la mesa (MI-46), '
  'external = se arregla fuera de la app (caja, efectivo, transferencia).';

-- El default es lo que un local puede honrar sin integrar ningún proveedor.
-- `mobile` se habilita a mano, cuando hay con qué cobrarlo.
alter table public.branches
  add column payment_methods public.payment_method[] not null default '{in_person,external}';

comment on column public.branches.payment_methods is
  'Medios de pago habilitados en la sucursal (MI-48). Vacío es válido: el local '
  'no cobra por la app, el comensal solo puede pedir la cuenta.';

-- El comensal no puede pedir un cobro que el local no ofrece: la app le esconde
-- el botón, pero la regla vive acá, que es donde no se puede saltar.
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

  -- Pedir la cuenta no es pagar: eso se puede siempre. Que venga un mozo a
  -- cobrar sí es un medio de pago, y la sucursal puede no ofrecerlo (MI-48).
  if p_kind = 'in_person_payment' and not exists (
    select 1 from public.tables t
    join public.branches b on b.id = t.branch_id
    where t.id = target.table_id and 'in_person' = any (b.payment_methods)
  ) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;

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

-- Descartar un envío cuyo resultado el comensal no conoce (se cortó la conexión).
--
-- Liberar el carrito solo en el cliente no alcanza: la request original puede
-- seguir en viaje y crear el pedido después, y el próximo envío (con otro
-- requestId) lo duplicaría. abandon_order_request resuelve las dos carreras
-- tomando el mismo lock de sesión que submit_order:
--   * Si el pedido ya existe, devuelve su id y no descarta nada.
--   * Si no existe, registra el requestId como abandonado y un trigger impide
--     que ese requestId se convierta en pedido aunque llegue más tarde.

create table public.abandoned_order_requests (
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  request_id uuid not null,
  abandoned_at timestamptz not null default now(),
  primary key (participant_id, request_id)
);

-- Solo se accede desde funciones security definer.
alter table public.abandoned_order_requests enable row level security;
revoke all on public.abandoned_order_requests from public, anon, authenticated;

create function public.reject_abandoned_order_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- submit_order inserta con la sesión bloqueada (for update), igual que
  -- abandon_order_request, así que esta lectura ve cualquier abandono confirmado.
  if exists (
    select 1 from public.abandoned_order_requests
    where participant_id = new.submitted_by and request_id = new.request_id
  ) then
    raise exception 'REQUEST_ABANDONED';
  end if;
  return new;
end;
$$;

create trigger orders_reject_abandoned_request
  before insert on public.orders
  for each row when (new.request_id is not null)
  execute function public.reject_abandoned_order_request();

create function public.abandon_order_request(p_session_id uuid, p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  participant uuid;
  existing_order uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;

  -- Mismo orden de locks que submit_order (mesa y después sesión): si hay un
  -- envío de esta sesión en curso, esperamos a que confirme o falle.
  perform 1 from public.tables t
    join public.table_sessions s on s.table_id = t.id
    where s.id = p_session_id for share of t;
  perform 1 from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select id into participant from public.session_participants
    where session_id = p_session_id and user_id = auth.uid();
  if participant is null then raise exception 'NOT_PARTICIPANT'; end if;

  select id into existing_order from public.orders
    where submitted_by = participant and request_id = p_request_id;
  if found then return existing_order; end if;

  insert into public.abandoned_order_requests (participant_id, request_id)
    values (participant, p_request_id)
    on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.reject_abandoned_order_request() from public, anon, authenticated;
revoke all on function public.abandon_order_request(uuid, uuid) from public, anon;
grant execute on function public.abandon_order_request(uuid, uuid) to authenticated;

comment on function public.abandon_order_request(uuid, uuid) is
  'Participants only. Returns the order id if the request already created one; otherwise returns null and guarantees the request id never becomes an order. Errors: AUTH_REQUIRED, INVALID_REQUEST, SESSION_NOT_FOUND, NOT_PARTICIPANT.';

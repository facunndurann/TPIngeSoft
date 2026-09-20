-- ============================================================
-- El comensal llama a una persona.
--
-- Pedir por QR no tiene salida hacia el personal: si algo sale mal, el comensal
-- no tiene a quién avisarle. `bill_requested_at` y
-- `in_person_payment_requested_at` ya existían esperando la acción del cliente,
-- pero no cubren "necesito al mozo" sin pedir la cuenta, así que se agrega
-- attention_requested_at. El plano del POS ya deriva su estado de estas
-- columnas (getPosTableState en packages/shared/src/pos.ts), así que el aviso
-- enciende la mesa sin más cambios en el servidor.
--
-- El aviso se puede cancelar: el comensal que se equivoca lo apaga solo.
-- ============================================================

alter table public.table_sessions add column attention_requested_at timestamptz;

comment on column public.table_sessions.attention_requested_at is
  'Momento en que la mesa llamó al mozo. Null cuando no hay llamado pendiente.';

create function public.request_table_service(
  p_session_id uuid,
  p_kind text,
  p_requested boolean default true
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  -- Null apaga el aviso; al encenderlo se conserva el momento del primero, así
  -- dos comensales pidiendo lo mismo no reinician la espera que ve el mozo.
  stamp timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind not in ('attention', 'bill') then raise exception 'INVALID_REQUEST'; end if;

  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;

  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  if p_kind = 'attention' then
    stamp := case when p_requested then coalesce(target.attention_requested_at, now()) end;
    update public.table_sessions set attention_requested_at = stamp where id = p_session_id;
  else
    stamp := case when p_requested then coalesce(target.bill_requested_at, now()) end;
    update public.table_sessions set bill_requested_at = stamp where id = p_session_id;
  end if;
end;
$$;

revoke all on function public.request_table_service(uuid, text, boolean) from public, anon;
grant execute on function public.request_table_service(uuid, text, boolean) to authenticated;

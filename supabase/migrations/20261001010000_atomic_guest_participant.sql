-- ============================================================
-- Agregar un invitado a la cuenta, de una sola vez.
--
-- Eran dos RPC seguidas: add_guest_participant creaba al invitado y después
-- reassign_order_items le pasaba los ítems. Si la segunda fallaba, el invitado
-- ya existía y reintentar creaba otro con el mismo nombre. Ahora es una sola
-- función y una sola transacción: queda el invitado con sus ítems, o no queda nada.
--
-- De paso valida lo mismo que el resto de las RPC del comensal: el nombre con
-- el límite de participantNameSchema, y que la sesión exista y siga abierta.
-- reassign_order_items desaparece: mover ítems sueltos no tiene otro uso.
-- ============================================================

drop function public.reassign_order_items(uuid[], uuid);
drop function public.add_guest_participant(uuid, text);

create function public.add_guest_participant(
  p_session_id uuid,
  p_display_name text,
  p_item_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  guest uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Mismo límite que customer_join_table_session y participantNameSchema.
  if p_display_name is null
     or length(trim(p_display_name)) < 1 or length(trim(p_display_name)) > 40 then
    raise exception 'INVALID_NAME';
  end if;

  -- Se bloquea la sesión, como en update_session_split: no se suma gente a una
  -- mesa que otro está cerrando en ese mismo momento.
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  -- Sin user_id: el invitado no tiene cuenta propia, lo agrega alguien de la mesa.
  insert into public.session_participants(session_id, display_name)
    values (p_session_id, trim(p_display_name))
    returning id into guest;

  -- Solo se reasignan ítems de pedidos de esta sesión; un id ajeno no mueve nada.
  update public.order_items set participant_id = guest
    where id = any(coalesce(p_item_ids, '{}'))
      and order_id in (select id from public.orders where session_id = p_session_id);

  return guest;
end;
$$;

revoke all on function public.add_guest_participant(uuid, text, uuid[]) from public, anon;
grant execute on function public.add_guest_participant(uuid, text, uuid[]) to authenticated;

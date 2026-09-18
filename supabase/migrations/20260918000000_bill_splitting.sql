-- Agregar configuración de división a la sesión de mesa
alter table public.table_sessions
  add column split_type text not null default 'none' check (split_type in ('none', 'equal', 'percentages')),
  add column split_allocations jsonb not null default '{}'::jsonb;

-- RPC para que cualquier participante actualice la división
create or replace function public.update_session_split(
  p_session_id uuid,
  p_split_type text,
  p_allocations jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Bloqueamos la fila para evitar condiciones de carrera
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;

  -- Solo un comensal de esta mesa puede cambiar la división
  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  update public.table_sessions
  set split_type = p_split_type,
      split_allocations = p_allocations
  where id = p_session_id;
end;
$$;

grant execute on function public.update_session_split(uuid, text, jsonb) to authenticated;
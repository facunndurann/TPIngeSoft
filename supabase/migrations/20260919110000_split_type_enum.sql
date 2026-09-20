-- La división de la cuenta pasa a tener el mismo contrato que el resto del
-- proyecto: enum real en lugar de `text` + check, y validación en Postgres con
-- los códigos del catálogo compartido (packages/shared/src/errors.ts), igual
-- que submit_order. Hasta ahora la RPC aceptaba cualquier jsonb.

create type public.split_type as enum ('none', 'equal', 'percentages');

-- El default es `'none'::text`: hay que soltarlo antes de cambiar el tipo.
alter table public.table_sessions alter column split_type drop default;
alter table public.table_sessions drop constraint if exists table_sessions_split_type_check;
alter table public.table_sessions
  alter column split_type type public.split_type using split_type::public.split_type;
alter table public.table_sessions
  alter column split_type set default 'none'::public.split_type;

-- Cambia el tipo de un argumento, así que la versión text no se reemplaza: se borra.
drop function if exists public.update_session_split(uuid, text, jsonb);

create function public.update_session_split(
  p_session_id uuid,
  p_split_type public.split_type,
  p_allocations jsonb default '{}'::jsonb
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

  -- Se bloquea la fila: dos comensales no pueden pisarse la división.
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;

  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  if jsonb_typeof(allocations) <> 'object' then raise exception 'INVALID_SPLIT'; end if;

  -- Fuera de `percentages` no hay asignaciones que puedan quedar viejas y
  -- reaparecer apuntando a comensales que ya no están en la mesa.
  if p_split_type <> 'percentages' then
    if allocations <> '{}'::jsonb then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions
      set split_type = p_split_type, split_allocations = '{}'::jsonb
      where id = p_session_id;
    return;
  end if;

  -- Los tres chequeos van separados: en un solo `or` Postgres podría evaluar el
  -- casteo a numeric de un valor que no es número y levantar 22P02 en vez de
  -- INVALID_SPLIT.
  if exists (
    select 1 from jsonb_each(allocations) a where jsonb_typeof(a.value) <> 'number'
  ) then raise exception 'INVALID_SPLIT'; end if;

  if exists (
    select 1 from jsonb_each(allocations) a
    where (a.value)::numeric < 0 or (a.value)::numeric > 100
  ) then raise exception 'INVALID_SPLIT'; end if;

  -- Las claves se comparan como texto: una clave que no sea uuid tiene que dar
  -- INVALID_SPLIT, no un error de casteo.
  if exists (
    select 1 from jsonb_object_keys(allocations) as k(id)
    where k.id not in (
      select sp.id::text from public.session_participants sp where sp.session_id = p_session_id
    )
  ) then raise exception 'INVALID_SPLIT'; end if;

  select coalesce(sum((a.value)::numeric), 0) into total from jsonb_each(allocations) a;
  if total <> 100 then raise exception 'INVALID_SPLIT'; end if;

  update public.table_sessions
    set split_type = p_split_type, split_allocations = allocations
    where id = p_session_id;
end;
$$;

revoke all on function public.update_session_split(uuid, public.split_type, jsonb)
  from public, anon;
grant execute on function public.update_session_split(uuid, public.split_type, jsonb)
  to authenticated;

-- ============================================================
-- Quién cambió la división de la cuenta.
--
-- La división es de la mesa: cualquier comensal la edita y el último guardado
-- manda. Hasta ahora eso pasaba en silencio: el que estaba con el editor
-- abierto seguía viendo su borrador, y al guardar pisaba al otro sin que
-- ninguno se enterara. La pantalla no puede avisar "fulano cambió la división"
-- si la sesión no guarda quién la tocó ni cuándo.
--
-- `split_updated_at` cambia en cada guardado aunque los valores queden iguales:
-- es lo que le permite al cliente distinguir "llegó un cambio nuevo" de
-- "volví a leer lo mismo".
-- ============================================================

-- `split_updated_by` guarda un id de session_participants, pero a propósito SIN
-- clave foránea: una FK de table_sessions a session_participants le agrega a
-- PostgREST un segundo camino entre las dos tablas y los `select` que ya
-- incorporan los comensales de una sesión pasan a resolverse por el camino
-- equivocado (devolverían el autor en lugar de la mesa entera). Para un rótulo
-- no hace falta integridad referencial: si ese comensal ya no está, la pantalla
-- dice "Otro comensal".
alter table public.table_sessions
  add column split_updated_by uuid,
  add column split_updated_at timestamptz;

comment on column public.table_sessions.split_updated_by is
  'Comensal (session_participants.id) que guardó la división vigente. Sin FK a propósito: ver la migración.';
comment on column public.table_sessions.split_updated_at is
  'Momento del último guardado de la división, aunque no haya cambiado ningún valor.';

create or replace function public.update_session_split(
  p_session_id uuid,
  p_split_type public.split_type,
  p_allocations jsonb default '{}'::jsonb,
  p_equal_parts integer default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  allocations jsonb := coalesce(p_allocations, '{}'::jsonb);
  author uuid;
  total numeric;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  select id into author from public.session_participants
    where session_id = p_session_id and user_id = auth.uid();
  if author is null then raise exception 'NOT_PARTICIPANT'; end if;
  if jsonb_typeof(allocations) <> 'object' then raise exception 'INVALID_SPLIT'; end if;

  if p_split_type = 'equal' then
    if allocations <> '{}'::jsonb or p_equal_parts is null
      or p_equal_parts < 2 or p_equal_parts > 50
      then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = p_equal_parts,
      split_updated_by = author,
      split_updated_at = now()
    where id = p_session_id;
    return;
  end if;

  if p_equal_parts is not null then raise exception 'INVALID_SPLIT'; end if;
  if p_split_type <> 'percentages' then
    if allocations <> '{}'::jsonb then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = null,
      split_updated_by = author,
      split_updated_at = now()
    where id = p_session_id;
    return;
  end if;

  if exists (
    select 1 from jsonb_each(allocations) a where jsonb_typeof(a.value) <> 'number'
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_each(allocations) a
    where (a.value)::numeric < 0 or (a.value)::numeric > 100
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_object_keys(allocations) as k(id)
    where k.id not in (
      select sp.id::text from public.session_participants sp where sp.session_id = p_session_id
    )
  ) then raise exception 'INVALID_SPLIT'; end if;
  select coalesce(sum((a.value)::numeric), 0) into total from jsonb_each(allocations) a;
  if total <> 100 then raise exception 'INVALID_SPLIT'; end if;

  update public.table_sessions set
    split_type = p_split_type,
    split_allocations = allocations,
    split_equal_parts = null,
    split_updated_by = author,
    split_updated_at = now()
  where id = p_session_id;
end;
$$;

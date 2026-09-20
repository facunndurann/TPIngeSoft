-- ============================================================
-- Autoría del último cambio de división de la cuenta.
--
-- La división es estado compartido de la mesa: cualquier comensal la cambia y
-- el resto la ve cambiar por Realtime. Sin autor ni momento, la app no puede
-- explicar por qué se movió el importe de cada uno.
--
-- El autor es el usuario, no su fila de participación: `session_participants`
-- ya apunta a `table_sessions`, y una segunda relación entre las dos tablas
-- dejaría ambiguos los `embed` de PostgREST que las combinan. Con el id de
-- usuario, el nombre a mostrar sale del participante que tenga hoy la mesa.
-- ============================================================

alter table public.table_sessions
  add column split_updated_by uuid references auth.users (id) on delete set null,
  add column split_updated_at timestamptz;

comment on column public.table_sessions.split_updated_by is
  'Comensal que cambió la división por última vez; la app lo muestra como autor del cambio.';
comment on column public.table_sessions.split_updated_at is
  'Momento del último cambio de división. Null mientras la mesa nunca la cambió.';

-- Misma firma que en 20260919110000, así que `create or replace` conserva los
-- permisos de esa migración. Lo único que cambia es que cada `update` firma el
-- cambio con quien lo hizo; las validaciones quedan idénticas.
create or replace function public.update_session_split(
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
      set split_type = p_split_type,
          split_allocations = '{}'::jsonb,
          split_updated_by = auth.uid(),
          split_updated_at = now()
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
    set split_type = p_split_type,
        split_allocations = allocations,
        split_updated_by = auth.uid(),
        split_updated_at = now()
    where id = p_session_id;
end;
$$;

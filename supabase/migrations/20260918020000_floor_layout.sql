-- ============================================================
-- MI-66: representar el salón real del restaurante.
--
-- Hasta ahora una mesa era solo una etiqueta con QR dentro de una sucursal.
-- Para que el POS pueda dibujar un plano operativo (MI-62/63/64) hace falta
-- agrupar las mesas en sectores y darle a cada una posición, capacidad y forma.
--
-- Dos banderas distintas, porque responden preguntas distintas:
--   is_active  : la mesa está fuera de servicio (el QR tampoco abre sesión).
--   is_visible : la mesa existe y funciona, pero no se dibuja en el plano
--                (barra de apoyo, mesa de depósito, mobiliario que no se atiende).
-- Ninguna de las dos se puede operar desde el mapa.
-- ============================================================

-- ---------- Sectores / salones ----------

create table public.floor_sections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Un sector no se repite dentro de la misma sucursal.
  unique (branch_id, name),
  -- Destino de la clave compuesta de tables: ata el sector a su sucursal.
  unique (id, branch_id)
);

create index on public.floor_sections (restaurant_id);
create index on public.floor_sections (branch_id, sort_order);

-- ---------- Layout de cada mesa ----------

alter table public.tables
  add column section_id uuid,
  -- Celdas de la grilla compartida (packages/shared/src/floor.ts). El rango acá
  -- es solo un tope sano: el tamaño real de la grilla lo define el front.
  add column position_x integer not null default 0,
  add column position_y integer not null default 0,
  add column seats integer not null default 4,
  add column shape text not null default 'square',
  add column size text not null default 'medium',
  add column is_visible boolean not null default true;

alter table public.tables
  add constraint tables_position_range
    check (position_x between 0 and 99 and position_y between 0 and 99),
  add constraint tables_seats_range check (seats between 1 and 40),
  add constraint tables_shape_valid check (shape in ('square', 'round', 'rectangle')),
  add constraint tables_size_valid check (size in ('small', 'medium', 'large'));

-- Una mesa solo puede estar en un sector de su propia sucursal.
-- La lista de columnas en ON DELETE SET NULL requiere Postgres 15+ (Supabase ya
-- lo está): sin ella el borrado intentaría anular branch_id, que es NOT NULL.
alter table public.tables
  add constraint tables_section_same_branch
    foreign key (section_id, branch_id)
    references public.floor_sections (id, branch_id)
    on delete set null (section_id);

create index on public.tables (section_id);

-- ---------- Identificadores únicos dentro del local ----------

-- Renombra lo que ya estuviera duplicado para que la restricción pueda crearse.
with duplicated as (
  select id,
    row_number() over (partition by branch_id, label order by created_at, id) as position
  from public.tables
)
update public.tables t
  set label = t.label || ' (' || d.position || ')'
  from duplicated d
  where d.id = t.id and d.position > 1;

alter table public.tables
  add constraint tables_label_unique_per_branch unique (branch_id, label);

-- ---------- RLS ----------

alter table public.floor_sections enable row level security;

-- Lectura pública como el resto de la estructura del local; escritura solo del
-- administrador, igual que mesas y carta (MI-61).
create policy "read floor sections" on public.floor_sections for select using (true);
create policy "admins write floor sections" on public.floor_sections
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

comment on table public.floor_sections is
  'Sectores del salón (MI-66). Agrupan mesas para el plano operativo del POS.';
comment on column public.tables.is_visible is
  'La mesa se dibuja en el plano operativo. Una mesa oculta o inactiva no se puede operar desde el mapa.';

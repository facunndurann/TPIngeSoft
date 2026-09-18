-- ============================================================
-- MI-66: tamaño libre de mesa.
--
-- El primer modelo cruzaba tres formas con tres tamaños, así que el salón real
-- tenía que entrar en nueve combinaciones. Ahora cada mesa declara su ancho y
-- alto en celdas de la grilla, y `shape` queda solo como estilo visual:
-- 'rect' (esquinas redondeadas) o 'round' (elipse).
--
-- Una rectangular pasa a ser simplemente una mesa con ancho distinto del alto.
-- ============================================================

alter table public.tables
  add column width integer not null default 3,
  add column height integer not null default 3;

-- Conserva el tamaño que cada mesa tenía: mismos valores que devolvía
-- tableFootprint() en packages/shared/src/floor.ts antes de este cambio.
update public.tables set
  height = case size when 'small' then 2 when 'large' then 4 else 3 end,
  width = case size when 'small' then 2 when 'large' then 4 else 3 end
    + case when shape = 'rectangle' then 1 else 0 end;

alter table public.tables drop constraint tables_size_valid;
alter table public.tables drop column size;

-- 'square' y 'rectangle' eran la misma caja: los dos colapsan en 'rect'.
-- El check viejo se suelta antes de reescribir los valores, si no rechaza 'rect'.
alter table public.tables drop constraint tables_shape_valid;
update public.tables set shape = 'rect' where shape in ('square', 'rectangle');
alter table public.tables alter column shape set default 'rect';
alter table public.tables add constraint tables_shape_valid check (shape in ('rect', 'round'));

-- Tope sano, no el tamaño de la grilla: el recorte al plano lo hace el front
-- con las constantes compartidas.
alter table public.tables
  add constraint tables_span_range check (width between 1 and 24 and height between 1 and 24);

comment on column public.tables.width is
  'Ancho de la mesa en celdas de la grilla del plano (packages/shared/src/floor.ts).';
comment on column public.tables.height is
  'Alto de la mesa en celdas de la grilla del plano.';
comment on column public.tables.shape is
  'Solo estilo visual: rect (esquinas redondeadas) o round (elipse). El tamaño lo dan width y height.';

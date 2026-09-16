-- Diseños de carta como enum, igual que order_status: la base rechaza ids
-- desconocidos y `pnpm db:types` genera el tipo y la lista (Constants) que usa
-- el catálogo de packages/shared/src/designs.ts. Agregar un diseño requiere
-- `alter type public.menu_design add value ...` y su entrada en el catálogo.
create type public.menu_design as enum ('oliva', 'brasas', 'linterna');

-- La app ya mostraba cualquier valor desconocido con el diseño por defecto.
update public.restaurants set menu_design = 'oliva'
  where menu_design not in ('oliva', 'brasas', 'linterna');

-- Único lugar de la base con el diseño por defecto. Espejado en
-- DEFAULT_MENU_DESIGN; supabase/tests/edge.test.ts verifica que coincidan.
alter table public.restaurants
  alter column menu_design drop default,
  alter column menu_design type public.menu_design using menu_design::public.menu_design,
  alter column menu_design set default 'oliva';

-- Diseño visual de la carta del comensal. El id se resuelve en el catálogo
-- de la app (packages/shared); un valor desconocido usa el diseño por defecto.
alter table public.restaurants
  add column menu_design text not null default 'oliva';

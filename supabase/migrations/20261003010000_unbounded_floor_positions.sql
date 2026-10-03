-- El plano del salón no tiene bordes: una mesa va donde el administrador la
-- deje, también a la izquierda o arriba del origen. El POS agranda su plano
-- hasta abarcar todas las mesas. El tope ya no es el plano sino un rango sano,
-- para que un dato roto no mande una mesa a millones de celdas; el front usa el
-- mismo (FLOOR_BOUNDS en packages/shared/src/floor.ts).
alter table public.tables drop constraint tables_position_range;
alter table public.tables
  add constraint tables_position_range check (
    position_x between -10000 and 10000 and position_y between -10000 and 10000
  );

comment on column public.tables.position_x is
  'Columna de la esquina de arriba a la izquierda de la mesa, en celdas del plano. Puede ser negativa.';
comment on column public.tables.position_y is
  'Fila de la esquina de arriba a la izquierda de la mesa, en celdas del plano. Puede ser negativa.';

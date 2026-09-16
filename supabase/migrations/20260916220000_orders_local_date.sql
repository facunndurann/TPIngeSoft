-- Día del restaurante de cada pedido, calculado por Postgres.
--
-- El admin convertía un día local en un rango UTC a mano (dayRangeUtc en
-- packages/shared/src/pos.ts) para filtrar el historial y las entregas de hoy.
-- Con la fecha ya calculada, filtra por igualdad contra una clave YYYY-MM-DD.
--
-- AT TIME ZONE con una zona literal es inmutable, requisito de una columna
-- generada; la misma zona usa POS_TIME_ZONE (apps/admin/src/features/pos/time.ts)
-- para saber qué día es hoy.
alter table public.orders
  add column local_date date
  generated always as ((created_at at time zone 'America/Argentina/Buenos_Aires')::date) stored;

create index orders_restaurant_local_date_idx on public.orders (restaurant_id, local_date);

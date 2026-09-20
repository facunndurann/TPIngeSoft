import { supabase } from '@/lib/supabase'

/**
 * Tablas cuyo cambio invalida algo de la pantalla del POS.
 *
 * Todas se filtran por `restaurant_id` salvo `session_participants`, que no
 * tiene esa columna: la migración 20260916120000_restaurant_scoped_foreign_keys
 * la agregó al resto, no a esta. Postgres Changes solo filtra por columnas
 * propias de la tabla, así que el POS se despierta cuando se suma un comensal
 * en *cualquier* restaurante. No es una fuga de datos —el payload lo corta RLS—
 * pero sí un refetch de más: se arregla denormalizando `restaurant_id` acá,
 * como se hizo con las otras.
 */
const WATCHED_TABLES = [
  { table: 'orders', scoped: true },
  { table: 'table_sessions', scoped: true },
  { table: 'payments', scoped: true },
  { table: 'tables', scoped: true },
  { table: 'floor_sections', scoped: true },
  { table: 'branches', scoped: true },
  { table: 'session_participants', scoped: false },
] as const

export function subscribeToRestaurantPos(restaurantId: string, onChange: () => void) {
  const channel = WATCHED_TABLES.reduce(
    (subscription, { table, scoped }) =>
      subscription.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          ...(scoped ? { filter: `restaurant_id=eq.${restaurantId}` } : {}),
        },
        onChange,
      ),
    supabase.channel(`pos-${restaurantId}`),
  )

  // El primer aviso llega al conectarse: la pantalla parte de datos frescos.
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onChange()
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}

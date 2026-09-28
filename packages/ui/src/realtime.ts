import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AppSupabaseClient, Database } from '@restaurant-platform/shared'

/** Un cambio de tabla que le importa a una pantalla. */
export type ChangeListener = {
  table: keyof Database['public']['Tables']
  /** Qué eventos escuchar; por defecto, todos. */
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  /** Solo las filas que cumplen, como `session_id=eq.…`: Postgres Changes filtra por columnas propias. */
  filter?: string
}

/** Espera entre reintentos: crece hasta medio minuto para no castigar al servidor. */
export const REALTIME_RETRY_MS = [1000, 2000, 5000, 10000, 30000] as const

/**
 * Cambios de la base en vivo, con un canal que se vuelve a levantar solo.
 *
 * Sin esto, cuando la conexión se cae —se durmió el teléfono, se cortó el wifi
 * de la cocina— la pantalla quedaba muda para siempre sin que nadie se enterara:
 * el único respaldo era el refetch periódico, que además se pausa con la pestaña
 * en segundo plano. CHANNEL_ERROR, TIMED_OUT y CLOSED dejan el canal inservible;
 * el cliente reconecta el socket, pero no vuelve a suscribir el canal.
 *
 * Cada suscripción, la primera y cada reconexión, avisa con `onChange`: la
 * pantalla parte de datos frescos y lo que pasó sin línea se recupera con una
 * lectura en vez de perderse. Devuelve la función que corta la suscripción.
 */
export function subscribeToChanges(
  client: AppSupabaseClient,
  name: string,
  listeners: readonly ChangeListener[],
  onChange: () => void,
): () => void {
  let channel: RealtimeChannel | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let disposed = false

  const connect = () => {
    const current = listeners.reduce(
      (subscription, { table, event = '*', filter }) =>
        subscription.on(
          'postgres_changes',
          { event, schema: 'public', table, ...(filter ? { filter } : {}) },
          () => onChange(),
        ),
      client.channel(name),
    )
    channel = current
    current.subscribe((status) => {
      // Soltar un canal viejo le dispara su propio CLOSED. Ese aviso no es una
      // caída del canal de ahora: si contara, cada reconexión programaría otra
      // que tiraría abajo al canal sano recién levantado, en un bucle sin fin.
      if (disposed || channel !== current) return
      if (status === 'SUBSCRIBED') {
        attempt = 0
        onChange()
        return
      }
      reconnect()
    })
  }

  const reconnect = () => {
    if (retry) return
    const wait = REALTIME_RETRY_MS[Math.min(attempt, REALTIME_RETRY_MS.length - 1)]
    attempt += 1
    retry = setTimeout(() => {
      retry = undefined
      if (disposed) return
      const stale = channel
      channel = undefined
      // Se espera a soltar el canal viejo: dos canales con el mismo nombre en
      // el mismo socket se rechazan entre sí.
      void Promise.resolve(stale && client.removeChannel(stale)).finally(() => {
        if (!disposed) connect()
      })
    }, wait)
  }

  connect()

  return () => {
    disposed = true
    if (retry) clearTimeout(retry)
    if (channel) void client.removeChannel(channel)
  }
}

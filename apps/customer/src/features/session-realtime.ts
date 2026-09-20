import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Espera entre reintentos: crece hasta medio minuto para no castigar al servidor. */
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]

/**
 * Lo que pasa en la mesa, en vivo: comensales, división, pedidos y pagos.
 *
 * El canal se vuelve a levantar solo. Sin esto, cuando la conexión se cae —se
 * durmió el teléfono, se cortó el wifi— la pantalla quedaba muda para siempre y
 * el comensal no se enteraba de que había dejado de recibir cambios: el único
 * respaldo era el refetch cada 15 segundos, que además se pausa con la pestaña
 * en segundo plano.
 *
 * Cada reconexión avisa con `onChange`, así lo que pasó mientras no había línea
 * se recupera con una lectura en vez de perderse.
 */
export function subscribeToTableSession(sessionId: string, onChange: () => void) {
  const sessionFilter = `session_id=eq.${sessionId}`
  let channel: RealtimeChannel | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let disposed = false

  const connect = () => {
    channel = supabase
      .channel(`table-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_participants', filter: sessionFilter },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${sessionId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: sessionFilter },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: sessionFilter },
        onChange,
      )
      .subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          attempt = 0
          onChange()
          return
        }
        // CHANNEL_ERROR, TIMED_OUT y CLOSED dejan el canal inservible: hay que
        // rearmarlo. El cliente reconecta el socket, pero no re-suscribe esto.
        reconnect()
      })
  }

  const reconnect = () => {
    if (disposed || retry) return
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]
    attempt += 1
    retry = setTimeout(() => {
      retry = undefined
      if (disposed) return
      const stale = channel
      channel = undefined
      // Se espera a soltar el canal viejo: dos canales con el mismo nombre en
      // el mismo socket se rechazan entre sí.
      void Promise.resolve(stale && supabase.removeChannel(stale)).finally(() => {
        if (!disposed) connect()
      })
    }, wait)
  }

  connect()

  return () => {
    disposed = true
    if (retry) clearTimeout(retry)
    if (channel) void supabase.removeChannel(channel)
  }
}

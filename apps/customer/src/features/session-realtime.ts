import { subscribeToChanges } from '@restaurant-platform/ui'
import { supabase } from '@/lib/supabase'

/**
 * Lo que pasa en la mesa, en vivo: comensales, división, pedidos y pagos. El
 * canal se vuelve a levantar solo si se corta (ver `subscribeToChanges`).
 */
export function subscribeToTableSession(sessionId: string, onChange: () => void) {
  const bySession = `session_id=eq.${sessionId}`
  return subscribeToChanges(
    supabase,
    `table-${sessionId}`,
    [
      { table: 'session_participants', filter: bySession },
      // La sesión se crea antes de suscribirse y no se borra: solo cambia.
      { table: 'table_sessions', event: 'UPDATE', filter: `id=eq.${sessionId}` },
      { table: 'orders', filter: bySession },
      { table: 'payments', filter: bySession },
    ],
    onChange,
  )
}

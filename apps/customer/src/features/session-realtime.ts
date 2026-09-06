import { supabase } from '@/lib/supabase'

export function subscribeToTableSession(sessionId: string, onChange: () => void) {
  const sessionFilter = `session_id=eq.${sessionId}`

  const channel = supabase
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
      if (status === 'SUBSCRIBED') onChange()
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}

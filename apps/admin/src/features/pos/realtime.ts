import { supabase } from '@/lib/supabase'

export function subscribeToRestaurantPos(restaurantId: string, onChange: () => void) {
  const restaurantFilter = `restaurant_id=eq.${restaurantId}`

  const channel = supabase
    .channel(`pos-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: restaurantFilter },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'table_sessions', filter: restaurantFilter },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'payments', filter: restaurantFilter },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_participants' },
      onChange,
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange()
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}

import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Membership } from '@/restaurant/restaurant-context'

/** Membresía del usuario autenticado (restaurante + rol), o null si todavía no tiene una. */
export const myRestaurantQuery = queryOptions({
  queryKey: ['my-restaurant'],
  queryFn: async (): Promise<Membership | null> => {
    const { data, error } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, role, restaurants(*)')
      .limit(1)
    if (error) throw error
    const membership = data[0]
    if (!membership?.restaurants) return null
    return { restaurant: membership.restaurants, role: membership.role }
  },
})

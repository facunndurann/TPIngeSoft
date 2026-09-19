import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Membership } from '@/restaurant/restaurant-context'

/** Membresía administrativa (owner/manager activa), o null si todavía no tiene restaurante. */
export const myRestaurantQuery = queryOptions({
  queryKey: ['my-restaurant'],
  queryFn: async (): Promise<Membership | null> => {
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr) throw userErr
    const userId = userData.user?.id
    if (!userId) return null

    const { data, error } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, role, restaurants(*)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('role', ['owner', 'manager'])
      .limit(1)
    if (error) throw error
    const membership = data[0]
    if (!membership?.restaurants) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (profileError) throw profileError
      if (profile) throw new Error('Acceso administrativo no habilitado')
      return null
    }
    return { restaurant: membership.restaurants, role: membership.role }
  },
})

import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Restaurante que administra el usuario autenticado, o null si todavía no tiene uno. */
export const myRestaurantQuery = queryOptions({
  queryKey: ['my-restaurant'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, restaurants(*)')
      .limit(1)
    if (error) throw error
    return data[0]?.restaurants ?? null
  },
})

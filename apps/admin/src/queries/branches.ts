import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Sucursales completas. Las pantallas que muestran menos columnas usan esta misma query. */
export const branchesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['branches', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

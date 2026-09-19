import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const categoriesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['categories', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_categories')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('sort_order')
      if (error) throw error
      return data
    },
  })

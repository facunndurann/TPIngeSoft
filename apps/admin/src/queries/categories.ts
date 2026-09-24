import { queryOptions } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'

export const categoriesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['categories', restaurantId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('menu_categories')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('sort_order'),
      ),
  })

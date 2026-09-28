import { queryOptions } from '@tanstack/react-query'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

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

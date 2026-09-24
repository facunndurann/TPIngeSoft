import { queryOptions } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'

/**
 * Sucursales completas, activas e inactivas. Es la única consulta con esta key:
 * la pantalla que muestra menos columnas o solo las activas las recorta con
 * `select`, no con otra consulta que le pise la caché a las demás.
 */
export const branchesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['branches', restaurantId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('branches')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at'),
      ),
  })

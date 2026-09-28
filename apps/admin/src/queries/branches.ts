import { queryOptions } from '@tanstack/react-query'
import { type Tables, type TablesInsert, unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

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

export type Branch = Tables<'branches'>
/** Lo que se cambia de una sucursal al tocarlo: si está activa y con qué se le puede pagar. */
export type BranchPatch = Partial<Pick<Branch, 'is_active' | 'payment_methods'>>

export async function createBranch(branch: TablesInsert<'branches'>) {
  unwrap(await supabase.from('branches').insert(branch))
}

export async function updateBranch(branchId: string, patch: BranchPatch) {
  unwrap(await supabase.from('branches').update(patch).eq('id', branchId))
}

export async function deleteBranch(branchId: string) {
  unwrap(await supabase.from('branches').delete().eq('id', branchId))
}

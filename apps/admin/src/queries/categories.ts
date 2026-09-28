import { queryOptions } from '@tanstack/react-query'
import { type Tables, type TablesInsert, unwrap } from '@restaurant-platform/shared'
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

export type Category = Tables<'menu_categories'>
export type CategoryPatch = Partial<Pick<Category, 'name' | 'is_active'>>

export async function createCategory(category: TablesInsert<'menu_categories'>) {
  unwrap(await supabase.from('menu_categories').insert(category))
}

export async function updateCategory(categoryId: string, patch: CategoryPatch) {
  unwrap(await supabase.from('menu_categories').update(patch).eq('id', categoryId))
}

export async function deleteCategory(categoryId: string) {
  unwrap(await supabase.from('menu_categories').delete().eq('id', categoryId))
}

/**
 * Se manda la lista completa en el orden nuevo: la base la aplica de una vez y
 * rechaza la operación si la lista quedó desactualizada.
 */
export async function reorderCategories(restaurantId: string, categoryIds: string[]) {
  unwrap(await supabase.rpc('reorder_categories', { p_restaurant_id: restaurantId, p_category_ids: categoryIds }))
}

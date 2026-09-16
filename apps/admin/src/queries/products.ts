import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Categorías con sus productos, en una sola consulta: ningún producto queda sin agrupar. */
export const productsByCategoryQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['products', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_categories')
        .select('*, products(*)')
        .eq('restaurant_id', restaurantId)
        .order('sort_order')
        .order('sort_order', { referencedTable: 'products' })
      if (error) throw error
      return data
    },
  })

/** Producto a editar, con sus ingredientes y los grupos asignados en el orden guardado. */
export const productQuery = (productId: string) =>
  queryOptions({
    queryKey: ['product', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, product_ingredients(*), product_modifier_groups(group_id)')
        .eq('id', productId)
        .order('sort_order', { referencedTable: 'product_modifier_groups' })
        .single()
      if (error) throw error
      return data
    },
  })

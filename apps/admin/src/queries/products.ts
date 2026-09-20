import { queryOptions } from '@tanstack/react-query'
import { fromPostgres } from '@restaurant-platform/shared'
import { draftPrice, type ProductDraft } from '@/features/product-draft'
import { uploadMediaDrafts } from '@/features/product-media'
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

/**
 * Guarda el producto completo. Storage no participa de la transacción, así que
 * los archivos nuevos se suben antes y se borran si la RPC falla: no quedan
 * huérfanos ni un producto apuntando a una URL que no existe.
 *
 * Producto, ingredientes y grupos van juntos en `save_product` (listas
 * completas, en orden): si algo falla no queda nada guardado y reintentar no
 * duplica el producto.
 */
export async function saveProduct(input: {
  restaurantId: string
  /** Ausente al crear: la RPC devuelve el id nuevo. */
  productId?: string
  draft: ProductDraft
}): Promise<string> {
  const { restaurantId, productId, draft } = input
  const price = draftPrice(draft)
  if (price === null) throw new Error('El precio no es válido')

  const { urls: mediaUrls, discardUploads } = await uploadMediaDrafts(restaurantId, draft.media)

  const { data: savedId, error } = await supabase.rpc('save_product', {
    p_restaurant_id: restaurantId,
    p_product_id: productId,
    p_category_id: draft.categoryId,
    p_name: draft.name,
    p_description: draft.description,
    p_base_price: price,
    p_food_info: draft.foodInfo,
    p_dietary_tags: draft.dietaryTags,
    p_is_available: draft.isAvailable,
    p_media_urls: mediaUrls,
    p_ingredients: draft.ingredients,
    p_group_ids: draft.groupIds,
  })
  if (error) {
    // No se guardó nada, así que ningún producto referencia lo recién subido.
    await discardUploads()
    throw fromPostgres(error)
  }
  return savedId
}

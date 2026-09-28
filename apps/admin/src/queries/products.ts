import { queryOptions } from '@tanstack/react-query'
import type { ProductPayload } from '@/features/product-draft'
import type { MediaDraft } from '@/features/product-media'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

const MEDIA_BUCKET = 'product-images'

/** Categorías con sus productos, en una sola consulta: ningún producto queda sin agrupar. */
export const productsByCategoryQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['products', restaurantId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('menu_categories')
          .select('*, products(*)')
          .eq('restaurant_id', restaurantId)
          .order('sort_order')
          .order('sort_order', { referencedTable: 'products' }),
      ),
  })

/** Producto a editar, con sus ingredientes y los grupos asignados en el orden guardado. */
export const productQuery = (productId: string) =>
  queryOptions({
    queryKey: ['product', productId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('products')
          .select('*, product_ingredients(*), product_modifier_groups(group_id)')
          .eq('id', productId)
          .order('sort_order', { referencedTable: 'product_modifier_groups' })
          .single(),
      ),
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
  /** El borrador ya validado por `parseProductDraft`. */
  payload: ProductPayload
}): Promise<string> {
  const { restaurantId, productId, payload } = input
  const { urls: mediaUrls, discardUploads } = await uploadMediaDrafts(restaurantId, payload.media)

  try {
    return unwrap(
      await supabase.rpc('save_product', {
        p_restaurant_id: restaurantId,
        p_product_id: productId,
        p_category_id: payload.categoryId,
        p_name: payload.name,
        p_description: payload.description,
        p_base_price: payload.basePrice,
        p_food_info: payload.foodInfo,
        p_dietary_tags: payload.dietaryTags,
        p_is_available: payload.isAvailable,
        p_media_urls: mediaUrls,
        p_ingredients: payload.ingredients,
        p_group_ids: payload.groupIds,
      }),
    )
  } catch (error) {
    // No se guardó nada, así que ningún producto referencia lo recién subido.
    await discardUploads()
    throw error
  }
}

type Upload = { url: string; path?: string }

/**
 * Sube en paralelo los archivos nuevos y devuelve las URLs finales en el orden de la
 * lista. Si alguna subida falla, borra las que sí terminaron antes de propagar el error.
 * `discardUploads` permite deshacer las subidas si después falla el guardado del producto.
 */
export async function uploadMediaDrafts(
  restaurantId: string,
  drafts: MediaDraft[],
): Promise<{ urls: string[]; discardUploads: () => Promise<void> }> {
  const storage = supabase.storage.from(MEDIA_BUCKET)

  const results = await Promise.allSettled(drafts.map(async (draft): Promise<Upload> => {
    if (draft.type === 'saved') return { url: draft.media.url }
    const extension = draft.file.name.split('.').pop() ?? 'jpg'
    const path = `${restaurantId}/${crypto.randomUUID()}.${extension}`
    const { error } = await storage.upload(path, draft.file)
    if (error) throw error
    return { url: storage.getPublicUrl(path).data.publicUrl, path }
  }))

  const uploads = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const paths = uploads.flatMap((upload) => (upload.path ? [upload.path] : []))

  // Limpieza de mejor esfuerzo: si falla, no debe tapar el error original.
  const discardUploads = async () => {
    if (paths.length) await storage.remove(paths).catch(() => undefined)
  }

  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    await discardUploads()
    throw failure.reason
  }
  return { urls: uploads.map((upload) => upload.url), discardUploads }
}

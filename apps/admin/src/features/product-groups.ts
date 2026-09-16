type CategoryLike = { id: string; name: string }
type ProductLike = { category_id: string }

export type ProductGroup<P> = { id: string; name: string; products: P[] }

/** Grupo para productos cuya categoría no está en la lista (borrada, o todavía cargando). */
export const UNCATEGORIZED_GROUP_ID = 'sin-categoria'

/**
 * Agrupa productos por categoría, en el orden de las categorías y omitiendo las vacías.
 * Ningún producto se pierde: los que no tienen una categoría conocida van al final, en
 * "Sin categoría".
 */
export function groupProductsByCategory<P extends ProductLike>(
  products: readonly P[],
  categories: readonly CategoryLike[],
): ProductGroup<P>[] {
  const byCategory = new Map<string, P[]>()
  for (const product of products) {
    const known = categories.some((category) => category.id === product.category_id)
    const groupId = known ? product.category_id : UNCATEGORIZED_GROUP_ID
    byCategory.set(groupId, [...(byCategory.get(groupId) ?? []), product])
  }

  return [...categories, { id: UNCATEGORIZED_GROUP_ID, name: 'Sin categoría' }]
    .map((category) => ({ ...category, products: byCategory.get(category.id) ?? [] }))
    .filter((group) => group.products.length > 0)
}

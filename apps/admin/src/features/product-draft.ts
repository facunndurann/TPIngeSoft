import type { Tables } from '@restaurant-platform/shared'
import { parsePrice } from '@/features/price'
import { savedMediaDrafts, type MediaDraft } from '@/features/product-media'

/** Ingrediente tal como se envía a save_product; sin `id` es un ingrediente nuevo. */
export type IngredientDraft = {
  id?: string
  name: string
  is_removable: boolean
  is_available: boolean
}

/**
 * El producto mientras se edita. Es un solo objeto y no doce `useState`: el
 * formulario se monta ya con sus valores (`key` + `useState(initial)`), así que
 * no existe el estado "a medio hidratar" que antes cubría un flag y un efecto.
 *
 * `basePrice` es string porque es lo que hay en el input mientras se escribe;
 * `draftErrors` decide si ese texto es un precio.
 */
export type ProductDraft = {
  name: string
  description: string
  categoryId: string
  basePrice: string
  foodInfo: string
  dietaryTags: string[]
  isAvailable: boolean
  media: MediaDraft[]
  ingredients: IngredientDraft[]
  groupIds: string[]
}

type SavedProduct = Tables<'products'> & {
  product_ingredients: Tables<'product_ingredients'>[]
  product_modifier_groups: { group_id: string }[]
}

export function emptyDraft(): ProductDraft {
  return {
    name: '',
    description: '',
    categoryId: '',
    basePrice: '',
    foodInfo: '',
    dietaryTags: [],
    isAvailable: true,
    media: [],
    ingredients: [],
    groupIds: [],
  }
}

export function draftFrom(product: SavedProduct): ProductDraft {
  return {
    name: product.name,
    description: product.description ?? '',
    categoryId: product.category_id,
    basePrice: String(product.base_price),
    foodInfo: product.food_info ?? '',
    dietaryTags: product.dietary_tags,
    isAvailable: product.is_available,
    media: savedMediaDrafts(product),
    ingredients: [...product.product_ingredients]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, name, is_removable, is_available }) => ({ id, name, is_removable, is_available })),
    // Las asignaciones llegan en su sort_order desde productQuery.
    groupIds: product.product_modifier_groups.map((assignment) => assignment.group_id),
  }
}

/** Precio válido del borrador, o `null` si el texto todavía no lo es. */
export function draftPrice(draft: ProductDraft): number | null {
  return parsePrice(draft.basePrice)
}

/** Primer problema que impide guardar, o `null`. La base revalida igual. */
export function draftErrors(draft: ProductDraft): string | null {
  if (!draft.name.trim()) return 'El producto necesita un nombre'
  if (!draft.categoryId) return 'Elegí una categoría'
  if (draftPrice(draft) === null) return 'El precio no es válido'
  if (draft.ingredients.some((ingredient) => !ingredient.name.trim())) {
    return 'Todos los ingredientes necesitan nombre'
  }
  return null
}

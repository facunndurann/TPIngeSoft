import { parseAmount, type Tables } from '@restaurant-platform/shared'
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
  return parseAmount(draft.basePrice)
}

/** Un campo del formulario que puede tener un error: los fijos y cada ingrediente. */
export type DraftField = 'name' | 'categoryId' | 'basePrice' | `ingredient-${number}`

export type DraftError = { field: DraftField; message: string }

/**
 * Todo lo que impide guardar, en el orden del formulario y con el campo de cada
 * problema: así cada error se muestra debajo de su campo y el foco va al primero.
 * La base revalida igual.
 */
export function draftErrors(draft: ProductDraft): DraftError[] {
  const errors: DraftError[] = []
  if (!draft.name.trim()) errors.push({ field: 'name', message: 'El producto necesita un nombre.' })
  if (!draft.categoryId) errors.push({ field: 'categoryId', message: 'Elegí una categoría.' })
  if (draftPrice(draft) === null) {
    errors.push({ field: 'basePrice', message: 'Ingresá un precio de 0 o más, con hasta dos decimales.' })
  }
  draft.ingredients.forEach((ingredient, index) => {
    if (!ingredient.name.trim()) {
      errors.push({ field: `ingredient-${index}`, message: 'Escribí el ingrediente o quitalo.' })
    }
  })
  return errors
}

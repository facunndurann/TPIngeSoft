import { calculateItemPrice, type Tables } from '@restaurant-platform/shared'

export type Ingredient = Tables<'product_ingredients'>
export type ModifierOption = Tables<'modifier_options'>
export type ModifierGroup = Tables<'modifier_groups'> & { options: ModifierOption[] }

export type Product = Tables<'products'> & {
  /** Falso si su categoría está inactiva: el producto se resuelve en el carrito, pero no se puede pedir. */
  categoryActive: boolean
  ingredients: Ingredient[]
  groups: ModifierGroup[]
}

export type MenuCategory = Tables<'menu_categories'> & { products: Product[] }

export type Menu = {
  /** Categorías activas, en orden, con sus productos. */
  categories: MenuCategory[]
  /** Todos los productos del restaurante, incluidos los de categorías inactivas. */
  productsById: Map<string, Product>
}

/** Filas tal como llegan de la base (ver loadMenu): productos y grupos traen sus hijos anidados. */
export type MenuRows = {
  categories: Tables<'menu_categories'>[]
  products: (Tables<'products'> & {
    product_ingredients: Ingredient[]
    product_modifier_groups: { group_id: string }[]
  })[]
  groups: (Tables<'modifier_groups'> & { modifier_options: ModifierOption[] })[]
}

export type Selection = {
  optionIds: string[]
  removedIds: string[]
  quantity: number
  isShared: boolean
}

/**
 * Arma el modelo de la carta una sola vez. Es el único lugar que cruza datos: los
 * helpers y componentes leen `product.ingredients` y `product.groups[].options`.
 * Un mismo grupo compartido por varios productos es el mismo objeto en todos.
 */
export function buildMenu({ categories, products, groups }: MenuRows): Menu {
  const groupsById = new Map(
    groups.map(({ modifier_options, ...group }) => [group.id, { ...group, options: modifier_options }]),
  )
  const activeCategoryIds = new Set(categories.map((category) => category.id))

  const productsById = new Map<string, Product>()
  for (const { product_ingredients, product_modifier_groups, ...product } of products) {
    productsById.set(product.id, {
      ...product,
      categoryActive: activeCategoryIds.has(product.category_id),
      ingredients: product_ingredients,
      // Las asignaciones llegan en su sort_order; la FK garantiza que el grupo existe.
      groups: product_modifier_groups.flatMap(({ group_id }) => groupsById.get(group_id) ?? []),
    })
  }

  const allProducts = [...productsById.values()]
  return {
    categories: categories.map((category) => ({
      ...category,
      products: allProducts.filter((product) => product.category_id === category.id),
    })),
    productsById,
  }
}

export function matchesSearch(product: Pick<Product, 'name' | 'description'>, search: string) {
  const text = `${product.name} ${product.description ?? ''}`.toLocaleLowerCase()
  return text.includes(search.toLocaleLowerCase())
}

/** Opciones de todos los grupos del producto. */
export function productOptions(product: Product): ModifierOption[] {
  return product.groups.flatMap((group) => group.options)
}

export function selectionErrors(product: Product, selection: Selection): string[] {
  const errors: string[] = []

  if (!product.is_available || !product.categoryActive) {
    errors.push('Este producto no está disponible.')
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) {
    errors.push('Elegí entre 1 y 99 unidades.')
  }

  const unknownRemoval = selection.removedIds.some(
    (id) => !product.ingredients.some((ingredient) => ingredient.id === id && ingredient.is_removable),
  )
  if (unknownRemoval) errors.push('Hay ingredientes que no se pueden quitar.')

  const missingUnavailable = product.ingredients.some(
    (ingredient) =>
      !ingredient.is_available &&
      (!ingredient.is_removable || !selection.removedIds.includes(ingredient.id)),
  )
  if (missingUnavailable) {
    errors.push('Hay ingredientes agotados. Quitalos si el plato lo permite.')
  }

  for (const group of product.groups) {
    const selected = group.options.filter((option) => selection.optionIds.includes(option.id))
    if (selected.length < group.min_select || selected.length > group.max_select) {
      errors.push(`${group.name}: elegí entre ${group.min_select} y ${group.max_select} opciones.`)
    }
    if (
      selected.some((option) => !option.is_available) ||
      (!group.is_available && (group.min_select > 0 || selected.length > 0))
    ) {
      errors.push(`${group.name} no está disponible.`)
    }
  }

  const uniqueOptions = new Set(selection.optionIds).size === selection.optionIds.length
  const options = productOptions(product)
  const knownOptions = selection.optionIds.every((id) => options.some((option) => option.id === id))
  if (!uniqueOptions || !knownOptions) {
    errors.push('Hay opciones que ya no pertenecen al producto.')
  }

  return errors
}

export function price(product: Product, selection: Selection) {
  const selected = productOptions(product)
    .filter((option) => selection.optionIds.includes(option.id))
    .map((option) => ({ optionId: option.id, priceDelta: option.price_delta }))
  return calculateItemPrice(product.base_price, selected, selection.quantity)
}

export function cartPrice(menu: Menu, items: (Selection & { productId: string })[]) {
  return (
    items.reduce((cents, item) => {
      const product = menu.productsById.get(item.productId)
      return cents + (product ? Math.round(price(product, item) * 100) : 0)
    }, 0) / 100
  )
}

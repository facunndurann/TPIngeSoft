import {
  calculateItemPrice,
  MAX_ITEM_QUANTITY,
  MIN_ITEM_QUANTITY,
  type Tables,
} from '@restaurant-platform/shared'

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

/** Lo que el comensal eligió de un plato, con nombre: lo que se agrega y lo que se quita. */
export type SelectionDescription = {
  /** `priceDelta` falta cuando la opción ya no está en la carta: no hay precio que mostrar. */
  options: { id: string; name: string; priceDelta?: number }[]
  removed: { id: string; name: string }[]
}

/**
 * Nombra las opciones e ingredientes de una selección contra la carta de ahora. Lo
 * que la carta ya no tiene (o todavía no cargó) se nombra igual en todas partes, así
 * la línea editable del carrito y su resumen no pueden decir cosas distintas.
 */
export function describeSelection(
  product: Product | undefined,
  selection: Pick<Selection, 'optionIds' | 'removedIds'>,
): SelectionDescription {
  const options = product ? productOptions(product) : []
  return {
    options: selection.optionIds.map((id) => {
      const option = options.find((entry) => entry.id === id)
      return option
        ? { id, name: option.name, priceDelta: option.price_delta }
        : { id, name: 'opción por actualizar' }
    }),
    removed: selection.removedIds.map((id) => ({
      id,
      name: product?.ingredients.find((ingredient) => ingredient.id === id)?.name ?? 'ingrediente por actualizar',
    })),
  }
}

/** Cuántas opciones de este grupo están elegidas. */
export function selectedInGroup(group: ModifierGroup, optionIds: string[]): number {
  return group.options.filter((option) => optionIds.includes(option.id)).length
}

/** Un grupo de una sola opción se elige con radios: elegir otra reemplaza a la anterior. */
export function isSingleChoice(group: Pick<ModifierGroup, 'max_select'>) {
  return group.max_select === 1
}

/**
 * La regla del grupo en palabras. Es fija: lo que el comensal va eligiendo ya se
 * ve marcado, y el techo explica solo por qué el resto se apaga al alcanzarlo.
 */
export function groupRule(group: Pick<ModifierGroup, 'min_select' | 'max_select' | 'is_available'>): string {
  const { min_select: min, max_select: max } = group
  const rule = isSingleChoice(group)
    ? min > 0 ? 'Elegí 1' : 'Opcional'
    : min === 0 ? `Opcional · hasta ${max}`
      : min === max ? `Elegí ${max}`
        : `Elegí entre ${min} y ${max}`
  return group.is_available ? rule : `${rule} · Agotado`
}

/**
 * Lo que impide pedir una selección, ubicado donde se muestra: el editor pone cada
 * problema al lado de lo que hay que tocar, y el carrito los lee juntos con
 * `selectionErrors`. Las dos vistas salen de acá, así no pueden decir cosas distintas.
 */
export type SelectionIssues = {
  /** Del plato entero: disponibilidad, cantidad u opciones que ya no son suyas. */
  product: string[]
  /** Ingredientes agotados que siguen en el plato, o quitados que no se pueden quitar. */
  ingredients: string[]
  /** Por id de grupo, qué le falta o le sobra. Solo figuran los grupos con problema. */
  groups: Record<string, string>
}

export function selectionIssues(product: Product, selection: Selection): SelectionIssues {
  const issues: SelectionIssues = { product: [], ingredients: [], groups: {} }

  if (!product.is_available || !product.categoryActive) {
    issues.product.push('Este plato no está disponible.')
  }
  if (
    !Number.isInteger(selection.quantity) ||
    selection.quantity < MIN_ITEM_QUANTITY ||
    selection.quantity > MAX_ITEM_QUANTITY
  ) {
    issues.product.push(`Elegí entre ${MIN_ITEM_QUANTITY} y ${MAX_ITEM_QUANTITY} unidades.`)
  }
  const options = productOptions(product)
  const uniqueOptions = new Set(selection.optionIds).size === selection.optionIds.length
  const knownOptions = selection.optionIds.every((id) => options.some((option) => option.id === id))
  if (!uniqueOptions || !knownOptions) {
    issues.product.push('Hay opciones que ya no pertenecen al plato.')
  }

  const unknownRemoval = selection.removedIds.some(
    (id) => !product.ingredients.some((ingredient) => ingredient.id === id && ingredient.is_removable),
  )
  if (unknownRemoval) issues.ingredients.push('Hay ingredientes que no se pueden quitar.')
  const missingUnavailable = product.ingredients.some(
    (ingredient) =>
      !ingredient.is_available &&
      (!ingredient.is_removable || !selection.removedIds.includes(ingredient.id)),
  )
  if (missingUnavailable) {
    issues.ingredients.push('Hay ingredientes agotados. Quitalos si el plato lo permite.')
  }

  for (const group of product.groups) {
    const error = groupError(group, selection.optionIds)
    if (error) issues.groups[group.id] = error
  }
  return issues
}

/** Qué le falta o le sobra a un grupo, en una frase: lo agotado primero, porque no se arregla eligiendo. */
function groupError(group: ModifierGroup, optionIds: string[]): string | undefined {
  const selected = group.options.filter((option) => optionIds.includes(option.id))
  if (!group.is_available && (group.min_select > 0 || selected.length > 0)) return 'No está disponible.'
  if (selected.some((option) => !option.is_available)) return 'Lo que elegiste se agotó. Elegí otra opción.'
  if (selected.length < group.min_select) {
    return isSingleChoice(group) ? 'Elegí una opción.' : `Elegí al menos ${group.min_select}.`
  }
  if (selected.length > group.max_select) return `Elegí hasta ${group.max_select}.`
  return undefined
}

/** Todos los problemas de una selección en una lista, como los muestra el carrito. */
export function selectionErrors(product: Product, selection: Selection): string[] {
  const issues = selectionIssues(product, selection)
  return [
    ...issues.product,
    ...issues.ingredients,
    // Fuera del grupo, el error lleva su nombre: «Salsa: elegí una opción.»
    ...product.groups.flatMap((group) => {
      const error = issues.groups[group.id]
      return error ? [`${group.name}: ${error.charAt(0).toLowerCase()}${error.slice(1)}`] : []
    }),
  ]
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

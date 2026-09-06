import type { Tables } from '@restaurant-platform/shared'
import { calculateItemPrice } from '@restaurant-platform/shared'
import type { loadMenu } from './menu-api'

export type Product = Tables<'products'>
export type Menu = Awaited<ReturnType<typeof loadMenu>>
export type Selection = {
  optionIds: string[]
  removedIds: string[]
  quantity: number
  isShared: boolean
}

export const money = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value)

export function matchesSearch(product: Pick<Product, 'name' | 'description'>, search: string) {
  const text = `${product.name} ${product.description ?? ''}`.toLocaleLowerCase()
  return text.includes(search.toLocaleLowerCase())
}

export function productGroups(menu: Menu, id: string) {
  return menu.links
    .filter((link) => link.product_id === id)
    .flatMap((link) => menu.groups.filter((group) => group.id === link.group_id))
}

export function selectionErrors(menu: Menu, product: Product, selection: Selection): string[] {
  const errors: string[] = []

  if (!product.is_available || !menu.categories.some((category) => category.id === product.category_id)) {
    errors.push('Este producto no está disponible.')
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) {
    errors.push('Elegí entre 1 y 99 unidades.')
  }

  const ingredients = menu.ingredients.filter((ingredient) => ingredient.product_id === product.id)
  const unknownRemoval = selection.removedIds.some(
    (id) => !ingredients.some((ingredient) => ingredient.id === id && ingredient.is_removable),
  )
  if (unknownRemoval) errors.push('Hay ingredientes que no se pueden quitar.')

  const missingUnavailable = ingredients.some(
    (ingredient) =>
      !ingredient.is_available &&
      (!ingredient.is_removable || !selection.removedIds.includes(ingredient.id)),
  )
  if (missingUnavailable) {
    errors.push('Hay ingredientes agotados. Quitalos si el plato lo permite.')
  }

  const groups = productGroups(menu, product.id)
  for (const group of groups) {
    const selected = menu.options.filter(
      (option) => option.group_id === group.id && selection.optionIds.includes(option.id),
    )
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
  const knownOptions = selection.optionIds.every((id) =>
    menu.options.some(
      (option) => option.id === id && groups.some((group) => group.id === option.group_id),
    ),
  )
  if (!uniqueOptions || !knownOptions) {
    errors.push('Hay opciones que ya no pertenecen al producto.')
  }

  return errors
}

export function price(menu: Menu, product: Product, selection: Selection) {
  const selected = menu.options
    .filter((option) => selection.optionIds.includes(option.id))
    .map((option) => ({ optionId: option.id, priceDelta: option.price_delta }))
  return calculateItemPrice(product.base_price, selected, selection.quantity)
}

export function cartPrice(menu: Menu, items: (Selection & { productId: string })[]) {
  return (
    items.reduce((cents, item) => {
      const product = menu.products.find((entry) => entry.id === item.productId)
      return cents + (product ? Math.round(price(menu, product, item) * 100) : 0)
    }, 0) / 100
  )
}

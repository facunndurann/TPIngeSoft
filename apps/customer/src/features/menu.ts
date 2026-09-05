import type { Tables } from '@restaurant-platform/shared'
import { calculateItemPrice } from '@restaurant-platform/shared'
import type { loadMenu } from './menu-api'

export type Product = Tables<'products'>
export type Menu = Awaited<ReturnType<typeof loadMenu>>
export type Selection = { optionIds: string[]; removedIds: string[]; quantity: number; isShared: boolean }
export const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value)

export function productGroups(menu: Menu, id: string) {
  return menu.links.filter(l => l.product_id === id).flatMap(l => menu.groups.filter(g => g.id === l.group_id))
}
export function selectionErrors(menu: Menu, product: Product, selection: Selection): string[] {
  const errors: string[] = []
  if (!product.is_available || !menu.categories.some(c => c.id === product.category_id)) errors.push('Este producto no está disponible.')
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) errors.push('Elegí entre 1 y 99 unidades.')
  const ingredients = menu.ingredients.filter(i => i.product_id === product.id)
  if (selection.removedIds.some(id => !ingredients.some(i => i.id === id && i.is_removable))) errors.push('Hay ingredientes que no se pueden quitar.')
  if (ingredients.some(i => !i.is_available && (!i.is_removable || !selection.removedIds.includes(i.id)))) errors.push('Hay ingredientes agotados. Quitalos si el plato lo permite.')
  const groups = productGroups(menu, product.id)
  for (const group of groups) {
    const selected = menu.options.filter(o => o.group_id === group.id && selection.optionIds.includes(o.id))
    if (selected.length < group.min_select || selected.length > group.max_select) errors.push(`${group.name}: elegí entre ${group.min_select} y ${group.max_select} opciones.`)
    if (selected.some(o => !o.is_available) || (!group.is_available && (group.min_select > 0 || selected.length > 0))) errors.push(`${group.name} no está disponible.`)
  }
  if (new Set(selection.optionIds).size !== selection.optionIds.length || selection.optionIds.some(id => !menu.options.some(o => o.id === id && groups.some(g => g.id === o.group_id)))) errors.push('Hay opciones que ya no pertenecen al producto.')
  return errors
}
export function price(menu: Menu, product: Product, selection: Selection) {
  return calculateItemPrice(product.base_price, menu.options.filter(o => selection.optionIds.includes(o.id)).map(o => ({ optionId: o.id, priceDelta: o.price_delta })), selection.quantity)
}

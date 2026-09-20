import { buildMenu } from '../src/features/menu'
import type { MenuRows } from '../src/features/menu'

// Filas mínimas como las devuelve loadMenu; el modelo se arma con buildMenu, igual que en la app.
export const menuRows = {
  categories: [{ id: 'c' }],
  products: [{
    id: 'p', category_id: 'c', is_available: true, base_price: 10.10,
    product_ingredients: [{ id: 'i', product_id: 'p', is_removable: true, is_available: true }],
    product_modifier_groups: [{ group_id: 'g' }],
  }],
  groups: [{
    id: 'g', name: 'Salsa', min_select: 1, max_select: 1, is_available: true,
    modifier_options: [{ id: 'o', group_id: 'g', price_delta: .20, is_available: true }, { id: 'o2', group_id: 'g', price_delta: 1, is_available: true }],
  }],
} as unknown as MenuRows

export const menu = buildMenu(menuRows)
export const product = menu.productsById.get('p')!

/** Producto 'p' tras cambiar una fila, como llegaría en el siguiente refetch de la carta. */
export function productAfter(change: (changed: MenuRows) => void) {
  const changed = structuredClone(menuRows)
  change(changed)
  return buildMenu(changed).productsById.get('p')!
}

/** Una selección válida del producto 'p': la base de casi todas las pruebas. */
export const selection = { optionIds: ['o'], removedIds: [], quantity: 3, isShared: false }

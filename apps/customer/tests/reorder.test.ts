import { test } from 'vitest'
import assert from 'node:assert/strict'
import { plateCount } from '../src/features/cart'
import { buildMenu, selectionErrors } from '../src/features/menu'
import type { MenuRows } from '../src/features/menu'
import { reorderAnnouncement, reorderLines } from '../src/features/reorder'
import type { OrderedLine } from '../src/features/reorder'
import { menu, product } from './fixtures'

test('repeating an order rebuilds only what the current menu still serves', () => {
  const line = (overrides: Partial<OrderedLine> = {}): OrderedLine => ({
    product_id: 'p',
    product_name: 'Milanesa',
    quantity: 2,
    is_shared: true,
    order_item_modifiers: [{ option_id: 'o' }],
    order_item_removed_ingredients: [{ ingredient_id: 'i' }],
    ...overrides,
  })

  const { items, skipped } = reorderLines([line()], menu)
  assert.deepEqual(skipped, [])
  assert.equal(items.length, 1)
  const [repeated] = items
  // Vuelve el mismo plato, con id nuevo para ser una línea propia del carrito.
  assert.equal(repeated.productId, 'p')
  assert.equal(repeated.quantity, 2)
  assert.equal(repeated.isShared, true)
  assert.deepEqual(repeated.optionIds, ['o'])
  assert.deepEqual(repeated.removedIds, ['i'])
  assert.notEqual(repeated.id, reorderLines([line()], menu).items[0].id)
  assert.equal(selectionErrors(product, repeated).length, 0, 'lo repetido tiene que poder enviarse')

  // Lo que el comensal eligió y hoy no está sale con su nombre: el plato sería otro.
  assert.deepEqual(reorderLines([line({ product_id: 'no-existe' })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ product_id: null })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ order_item_modifiers: [{ option_id: 'vieja' }] })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ order_item_removed_ingredients: [{ ingredient_id: 'otro' }] })], menu).skipped, ['Milanesa'])
  // El grupo obligatorio sigue siendo obligatorio: sin su opción no se repite.
  assert.deepEqual(reorderLines([line({ order_item_modifiers: [] })], menu).skipped, ['Milanesa'])

  // Una tanda mezclada agrega lo que puede y nombra lo que no.
  const mixed = reorderLines([line(), line({ product_id: 'no-existe', product_name: 'Flan' })], menu)
  assert.equal(mixed.items.length, 1)
  assert.deepEqual(mixed.skipped, ['Flan'])

  // El aviso es una sola línea: cuánto entró al carrito y qué quedó afuera, con
  // su nombre, para poder buscarlo en la carta.
  assert.equal(reorderAnnouncement(mixed), 'Agregamos 1 plato a tu carrito. No pudimos repetir: Flan.')
  assert.equal(reorderAnnouncement({ items, skipped: [] }), 'Agregamos 1 plato a tu carrito.')
  assert.equal(
    reorderAnnouncement({ items: [], skipped: ['Milanesa', 'Flan'] }),
    'Este pedido ya no se puede repetir igual. No pudimos repetir: Milanesa, Flan.',
  )

  // Un ingrediente agotado que se puede quitar se quita solo, como al agregarlo hoy.
  const soldOutIngredient = buildMenu({
    categories: [{ id: 'c' }],
    products: [{
      id: 'p2', category_id: 'c', is_available: true, base_price: 10,
      product_ingredients: [
        { id: 'i1', product_id: 'p2', is_removable: true, is_available: false },
        { id: 'i2', product_id: 'p2', is_removable: true, is_available: true },
      ],
      product_modifier_groups: [],
    }],
    groups: [],
  } as unknown as MenuRows)
  const forced = reorderLines(
    [line({ product_id: 'p2', order_item_modifiers: [], order_item_removed_ingredients: [{ ingredient_id: 'i2' }] })],
    soldOutIngredient,
  )
  assert.deepEqual(forced.items[0].removedIds.slice().sort(), ['i1', 'i2'])

  assert.equal(plateCount(1), '1 plato')
  assert.equal(plateCount(3), '3 platos')
})

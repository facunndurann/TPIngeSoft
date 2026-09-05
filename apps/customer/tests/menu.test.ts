import { test } from 'node:test'
import assert from 'node:assert/strict'
import { price, selectionErrors } from '../src/features/menu'
import { calculateItemPrice } from '@restaurant-platform/shared'

const product = { id: 'p', category_id: 'c', is_available: true, base_price: 10.10 }
const menu = {
  categories: [{ id: 'c' }], products: [product],
  ingredients: [{ id: 'i', product_id: 'p', is_removable: true, is_available: true }],
  links: [{ product_id: 'p', group_id: 'g' }],
  groups: [{ id: 'g', name: 'Salsa', min_select: 1, max_select: 1, is_available: true }],
  options: [{ id: 'o', group_id: 'g', price_delta: .20, is_available: true }, { id: 'o2', group_id: 'g', price_delta: 1, is_available: true }],
}
const selection = { optionIds: ['o'], removedIds: [], quantity: 3, isShared: false }
test('required single-choice groups and decimal pricing', () => {
  assert.deepEqual(selectionErrors(menu, product, selection), [])
  assert.equal(price(menu, product, selection), 30.90)
  assert.equal(calculateItemPrice(.1, [{ optionId: 'o', priceDelta: .2 }], 3), .9)
  assert.ok(selectionErrors(menu, product, { ...selection, optionIds: [] }).length)
  assert.ok(selectionErrors(menu, product, { ...selection, optionIds: ['o', 'o2'] }).length)
})
test('rejects unknown, duplicated and unavailable modifiers', () => {
  for (const optionIds of [['other'], ['o', 'o']]) assert.ok(selectionErrors(menu, product, { ...selection, optionIds }).length)
  const changed = structuredClone(menu)
  changed.options[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
  changed.groups[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
})
test('unavailable ingredients require removal and fixed ingredients cannot be removed', () => {
  const changed = structuredClone(menu)
  changed.ingredients[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
  assert.deepEqual(selectionErrors(changed, product, { ...selection, removedIds: ['i'] }), [])
  changed.ingredients[0].is_removable = false
  assert.ok(selectionErrors(changed, product, { ...selection, removedIds: ['i'] }).length)
  assert.ok(selectionErrors(menu, product, { ...selection, removedIds: ['unknown'] }).length)
})
test('rejects inactive categories, unavailable products and invalid quantities', () => {
  assert.ok(selectionErrors({ ...menu, categories: [] }, product, selection).length)
  assert.ok(selectionErrors(menu, { ...product, is_available: false }, selection).length)
  for (const quantity of [0, -1, 1.5, 100, NaN]) assert.ok(selectionErrors(menu, product, { ...selection, quantity }).length)
})
test('cart edits preserve customization and isolate participants and sessions', async () => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } })
  const { useCart } = await import('../src/stores/cart')
  const item = { ...selection, id: 'line', productId: 'p', removedIds: ['i'], isShared: true }
  useCart.getState().save('session-a:user-a', item)
  useCart.getState().save('session-a:user-b', { ...item, quantity: 1 })
  useCart.getState().save('session-b:user-a', { ...item, quantity: 2 })
  useCart.getState().save('session-a:user-a', { ...item, quantity: 4 })
  assert.equal(useCart.getState().carts['session-a:user-a'].length, 1)
  assert.deepEqual(useCart.getState().carts['session-a:user-a'][0].removedIds, ['i'])
  assert.equal(useCart.getState().carts['session-a:user-b'][0].quantity, 1)
  assert.equal(useCart.getState().carts['session-b:user-a'][0].quantity, 2)
  const saved = memory.get('customer-carts')!
  useCart.setState({ carts: {} })
  memory.set('customer-carts', saved)
  useCart.persist.rehydrate()
  assert.equal(useCart.getState().carts['session-a:user-a'][0].quantity, 4)
  assert.equal(useCart.getState().carts['session-a:user-a'][0].isShared, true)
  useCart.getState().remove('session-a:user-a', 'line')
  assert.deepEqual(useCart.getState().carts['session-a:user-a'], [])
})

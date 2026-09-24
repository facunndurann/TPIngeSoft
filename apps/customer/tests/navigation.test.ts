import { test } from 'vitest'
import assert from 'node:assert/strict'
import { lastTable, rememberTable } from '../src/features/last-table'
import * as paths from '../src/features/table-paths'

test('customer table URLs encode screens, product pages and menu filters', () => {
  assert.equal(paths.tableRoot('demo-burger-mesa-1'), '/m/demo-burger-mesa-1')
  assert.equal(paths.menuSearchParams('all', ''), '')
  assert.equal(paths.menuSearchParams('burgers', ''), '?categoria=burgers')
  assert.equal(paths.menuSearchParams('all', 'pizza'), '?q=pizza')
  assert.equal(paths.menuSearchParams('burgers', 'pizza'), '?categoria=burgers&q=pizza')
  assert.equal(paths.menuPath('demo-burger-mesa-1', 'c1', 'ala'), '/m/demo-burger-mesa-1?categoria=c1&q=ala')
  assert.equal(paths.productPath('t', 'p1', '?categoria=c'), '/m/t/producto/p1?categoria=c')
  assert.equal(paths.cartPath('t'), '/m/t/carrito')
  assert.equal(paths.cartItemPath('t', 'item-1'), '/m/t/carrito/item-1')
  assert.equal(paths.ordersPath('t'), '/m/t/pedidos')
  assert.equal(paths.billPath('t'), '/m/t/cuenta')
  assert.deepEqual(paths.parseMenuFilters(new URLSearchParams('categoria=c&q=ala')), { category: 'c', search: 'ala' })
  assert.deepEqual(paths.parseMenuFilters(new URLSearchParams()), { category: 'all', search: '' })
})

test('the remembered table survives only as three usable strings', () => {
  assert.equal(lastTable(), undefined)
  rememberTable({ token: 'qr-1', tableLabel: 'Mesa 4', restaurantName: 'La Parrilla' })
  assert.deepEqual(lastTable(), { token: 'qr-1', tableLabel: 'Mesa 4', restaurantName: 'La Parrilla' })

  // Un valor viejo, incompleto o roto no puede ofrecer un enlace a medias.
  for (const stored of ['{"token":"qr-1"}', '{"token":"","tableLabel":"Mesa 4","restaurantName":"R"}', 'no-json', 'null']) {
    globalThis.localStorage.setItem('customer-last-table', stored)
    assert.equal(lastTable(), undefined)
  }
  globalThis.localStorage.removeItem('customer-last-table')
})

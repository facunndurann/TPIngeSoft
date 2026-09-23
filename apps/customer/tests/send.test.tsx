// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { Route } from 'react-router'
import { formatPrice } from '@restaurant-platform/shared'
import { cartPrice } from '../src/features/menu'
import { submitOrder } from '../src/features/orders-api'
import { cartPath, ordersPath } from '../src/features/table-paths'
import { TableCartItemPage, TableCartPage } from '../src/pages/TablePage'
import { useCart } from '../src/stores/cart'
import { menu, selection } from './fixtures'
import { cartKey, cleanupTables, pathnameIn, renderTable, settle, token } from './table-harness'

// Sin red: el cliente de Supabase no llega a crearse y el envío responde como el servidor.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock(import('../src/features/orders-api'), async (importOriginal) => ({
  ...(await importOriginal()),
  submitOrder: vi.fn(async () => ({
    orderId: '00000000-0000-4000-8000-000000000001',
    status: 'submitted' as const,
    totalAmount: 30.9,
  })),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const line = { ...selection, id: 'line-1', productId: 'p' }

afterEach(() => {
  cleanupTables()
  vi.mocked(submitOrder).mockClear()
})

/** Las rutas del carrito de App.tsx, con Pedidos reducida a su título. */
const cartRoutes = (
  <>
    <Route path="carrito" element={<TableCartPage />} />
    <Route path="carrito/:itemId" element={<TableCartItemPage />} />
    <Route path="pedidos" element={<h2>Pedidos</h2>} />
  </>
)

test('sending from the cart signs the total on the button and lands on the orders', async () => {
  useCart.getState().save(cartKey, line)
  const total = cartPrice(menu, [line])
  const container = await renderTable(cartPath(token), cartRoutes)

  const send = [...container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Enviar pedido'))
  assert.ok(send && !send.disabled)
  assert.equal(send.textContent, `Enviar pedido · ${formatPrice(total)}`)
  await act(async () => send.click())
  await settle()

  // Un solo toque: lo que dice el botón es lo que el servidor recibe como esperado.
  assert.equal(vi.mocked(submitOrder).mock.calls.length, 1)
  assert.equal(vi.mocked(submitOrder).mock.calls[0][0].expectedTotal, total)
  assert.deepEqual(useCart.getState().carts[cartKey], [])
  assert.equal(pathnameIn(container), ordersPath(token))
})

test('an old link to the removed review screen lands on the cart', async () => {
  useCart.getState().save(cartKey, line)
  // `carrito/revisar` ya no existe: la ruta de una línea del carrito la toma, no
  // encuentra la línea «revisar» y vuelve al carrito.
  const container = await renderTable(`${cartPath(token)}/revisar`, cartRoutes)
  await settle()

  assert.equal(pathnameIn(container), cartPath(token))
  assert.equal(vi.mocked(submitOrder).mock.calls.length, 0)
})

// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { formatPrice } from '@restaurant-platform/shared'
import { cartKeyFor } from '../src/features/cart'
import { cartPrice } from '../src/features/menu'
import { submitOrder } from '../src/features/orders-api'
import { sessionQuery } from '../src/features/session'
import { TableContext } from '../src/features/table-context'
import { cartPath, ordersPath, TABLE_ROUTE } from '../src/features/table-paths'
import { TableCartItemPage, TableCartPage } from '../src/pages/TablePage'
import { useCart } from '../src/stores/cart'
import { menu, selection } from './fixtures'

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

const token = 'mesa-1'
const sessionId = 'session-1'
const cartKey = cartKeyFor(sessionId, 'user-1')
const line = { ...selection, id: 'line-1', productId: 'p' }
const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  useCart.setState({ carts: {}, submissions: {} })
  vi.mocked(submitOrder).mockClear()
})

/**
 * La mesa como la publica `TableApp`, con lo que lee la pantalla del carrito. El
 * carrito sale del store, igual que en la app, así que el envío y la pantalla ven lo mismo.
 */
function Table() {
  const menuQuery = useQuery({ queryKey: ['menu'], queryFn: () => menu, initialData: menu })
  // La pantalla del carrito no lee la sesión: una consulta en espera alcanza.
  const session = useQuery(sessionQuery(undefined))
  const items = useCart((state) => state.carts[cartKey]) ?? []
  const { pathname } = useLocation()

  return (
    <TableContext
      value={{
        token,
        menu: menuQuery,
        session,
        sessionId,
        refreshTable: async () => {},
        me: undefined,
        nameOf: () => 'Ana',
        named: true,
        needsName: false,
        sessionOpen: true,
        closed: false,
        cartKey,
        items,
        cartTotal: cartPrice(menu, items),
        paymentMethods: [],
        canEdit: true,
        announce: () => {},
      }}
    >
      <output>{pathname}</output>
      <Outlet />
    </TableContext>
  )
}

/** Las rutas del carrito de App.tsx, con Pedidos reducida a su título. */
async function renderAt(path: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient()
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={TABLE_ROUTE} element={<Table />}>
              <Route path="carrito" element={<TableCartPage />} />
              <Route path="carrito/:itemId" element={<TableCartItemPage />} />
              <Route path="pedidos" element={<h2>Pedidos</h2>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  return container
}

/** Deja correr el envío, sus callbacks y las navegaciones que disparan. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

const pathnameIn = (container: HTMLElement) => container.querySelector('output')?.textContent

test('sending from the cart signs the total on the button and lands on the orders', async () => {
  useCart.getState().save(cartKey, line)
  const total = cartPrice(menu, [line])
  const container = await renderAt(cartPath(token))

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
  const container = await renderAt(`${cartPath(token)}/revisar`)
  await settle()

  assert.equal(pathnameIn(container), cartPath(token))
  assert.equal(vi.mocked(submitOrder).mock.calls.length, 0)
})

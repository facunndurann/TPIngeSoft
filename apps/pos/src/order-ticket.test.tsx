// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type PosContext } from './context/pos-context'
import { transitionPosOrder, type PosOrder } from './features/pos/queries'
import { OrderTicket } from './features/pos/OrderTicket'
import { createPosQueryClient } from './lib/query-client'

// Sin red: el cliente de Supabase no llega a crearse y la transición la decide cada prueba.
vi.mock('./lib/supabase', () => ({ supabase: {} }))
vi.mock(import('./features/pos/queries'), async (importOriginal) => ({
  ...(await importOriginal()),
  transitionPosOrder: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const context: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'orders.deliver', 'orders.cancel'],
}

/** Un pedido listo para entregar en la mesa `label`. */
const readyAt = (id: string, label: string) =>
  ({
    id,
    status: 'ready',
    total_amount: 20,
    created_at: new Date().toISOString(),
    notes: null,
    submitted_by: null,
    order_items: [],
    table_sessions: { status: 'open', session_participants: [], tables: { label } },
  }) as unknown as PosOrder

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(transitionPosOrder).mockReset()
  // happy-dom no trae window.confirm: cada prueba que cancela pone el suyo.
  Reflect.deleteProperty(window, 'confirm')
})

/** Varios tickets en la misma pantalla, como en el tablero. */
async function renderTickets(...orders: PosOrder[]) {
  const client = createPosQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AccessContext value={context}>
          {orders.map((order) => <OrderTicket key={order.id} order={order} now={Date.now()} />)}
        </AccessContext>
      </QueryClientProvider>,
    )
  })
  return { container, invalidate }
}

/** Deja correr las promesas de la mutación y los renders que disparan. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

const ticketOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('article')].find((article) => article.textContent?.includes(label))!

const buttonIn = (ticket: Element, text: string) =>
  [...ticket.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!

test('a pending transition only makes its own ticket busy', async () => {
  vi.mocked(transitionPosOrder).mockReturnValue(new Promise(() => {}))
  const { container } = await renderTickets(readyAt('order-a', 'Mesa 1'), readyAt('order-b', 'Mesa 2'))

  await act(async () => buttonIn(ticketOf(container, 'Mesa 1'), 'Entregar').click())
  await settle()

  const busy = buttonIn(ticketOf(container, 'Mesa 1'), 'Actualizando')
  assert.ok(busy?.disabled)
  assert.equal(buttonIn(ticketOf(container, 'Mesa 2'), 'Entregar').disabled, false)
  assert.deepEqual(vi.mocked(transitionPosOrder).mock.calls, [['order-a', 'delivered']])
})

test('a failed transition shows its error on that ticket and nowhere else', async () => {
  vi.mocked(transitionPosOrder).mockRejectedValue(new Error('El pedido ya cambió de estado.'))
  const { container, invalidate } = await renderTickets(readyAt('order-a', 'Mesa 1'), readyAt('order-b', 'Mesa 2'))

  await act(async () => buttonIn(ticketOf(container, 'Mesa 1'), 'Entregar').click())
  await settle()

  assert.match(ticketOf(container, 'Mesa 1').textContent ?? '', /El pedido ya cambió de estado\./)
  assert.doesNotMatch(ticketOf(container, 'Mesa 2').textContent ?? '', /El pedido ya cambió de estado\./)
  // Falló: se puede reintentar y no hay nada que refrescar.
  assert.equal(buttonIn(ticketOf(container, 'Mesa 1'), 'Entregar').disabled, false)
  assert.equal(invalidate.mock.calls.length, 0)
})

test('cancelling asks first and only runs once the staff confirms', async () => {
  vi.mocked(transitionPosOrder).mockResolvedValue(undefined)
  const confirm = vi.fn(() => false)
  Object.defineProperty(window, 'confirm', { configurable: true, value: confirm })
  const { container, invalidate } = await renderTickets(readyAt('order-a', 'Mesa 1'))

  await act(async () => buttonIn(ticketOf(container, 'Mesa 1'), 'Cancelar').click())
  assert.deepEqual(confirm.mock.calls, [['¿Cancelar el pedido de Mesa 1? Se saca de la cuenta.']])
  assert.equal(vi.mocked(transitionPosOrder).mock.calls.length, 0)

  confirm.mockReturnValue(true)
  await act(async () => buttonIn(ticketOf(container, 'Mesa 1'), 'Cancelar').click())
  await settle()

  assert.deepEqual(vi.mocked(transitionPosOrder).mock.calls, [['order-a', 'cancelled']])
  // Guardado: el cliente del POS relee todo (tablero, mesas, comanda).
  assert.deepEqual(invalidate.mock.calls, [[{ queryKey: ['pos'] }]])
})

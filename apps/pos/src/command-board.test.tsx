// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, scopeOf, type PosContext } from './context/pos-context'
import { CommandBoard } from './features/pos/CommandBoard'
import { posBoardQuery, type PosOrder } from './features/pos/queries'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const kitchen: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'orders.prepare'],
}

const orderAt = (id: string, label: string, status: PosOrder['status']) =>
  ({
    id, status, total_amount: 20, created_at: new Date().toISOString(), notes: null, submitted_by: null,
    order_items: [],
    table_sessions: { status: 'open', session_participants: [], tables: { label } },
  }) as unknown as PosOrder

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  localStorage.clear()
})

/** El tablero con un pedido nuevo y uno entregado ya en caché: sin red. */
async function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(posBoardQuery(scopeOf(kitchen)).queryKey, [
    orderAt('o1', 'Mesa 1', 'accepted'),
    orderAt('o9', 'Mesa 9', 'delivered'),
  ])
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AccessContext value={kitchen}><CommandBoard /></AccessContext>
      </QueryClientProvider>,
    ),
  )
  return container
}

const column = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!

test('from lg on the four columns share the width, so a landscape tablet sees them all', async () => {
  const container = await renderBoard()
  for (const label of ['Nuevo', 'En preparación', 'Listo', 'Entregado']) {
    assert.match(column(container, label).className, /\blg:flex-1\b/)
  }
})

test('Entregado folds into a strip, keeps focus on its toggle, and stays folded next time', async () => {
  const container = await renderBoard()
  const toggle = column(container, 'Entregado').querySelector<HTMLButtonElement>('button[aria-label="Plegar Entregado"]')!
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.match(column(container, 'Entregado').textContent ?? '', /Mesa 9/)

  toggle.focus()
  await act(async () => toggle.click())

  // Plegada: sin tickets, con su nombre y su cantidad, y el foco donde estaba.
  const folded = column(container, 'Entregado')
  assert.doesNotMatch(folded.textContent ?? '', /Mesa 9/)
  assert.match(folded.textContent ?? '', /Entregado.*1/)
  assert.equal(toggle.getAttribute('aria-label'), 'Mostrar Entregado')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, toggle)
  // Las otras columnas siguen como estaban.
  assert.match(column(container, 'Nuevo').textContent ?? '', /Mesa 1/)

  cleanups.splice(0).forEach((cleanup) => cleanup())
  const again = await renderBoard()
  assert.ok(column(again, 'Entregado').querySelector('button[aria-label="Mostrar Entregado"]'))
})

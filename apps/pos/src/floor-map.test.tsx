// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, scopeOf, type PosContext } from './context/pos-context'
import { FloorMap } from './features/pos/FloorMap'
import { posFloorSectionsQuery, posOpenSessionsQuery, posTablesQuery } from './features/pos/queries'
import { createPosQueryClient } from './lib/query-client'

// Sin red: el plano sale entero de la caché.
vi.mock('./lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const waiter: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'floor.read'],
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

/** El plano con una mesa libre, ya cargado y sin releer: la prueba no depende de la red. */
async function renderFloor() {
  const client = createPosQueryClient()
  client.setDefaultOptions({ queries: { staleTime: Infinity } })
  const scope = scopeOf(waiter)
  client.setQueryData(posFloorSectionsQuery(scope).queryKey, [
    { id: 'section-1', name: 'Salón', sort_order: 0, is_active: true },
  ])
  client.setQueryData(posTablesQuery(scope).queryKey, [
    {
      id: 'table-1',
      label: 'Mesa 1',
      section_id: 'section-1',
      seats: 4,
      shape: 'square',
      position_x: 0,
      position_y: 0,
      width: 2,
      height: 2,
      is_active: true,
      is_visible: true,
      floor_sections: { id: 'section-1', name: 'Salón', sort_order: 0, is_active: true },
    },
  ] as never)
  client.setQueryData(posOpenSessionsQuery(scope).queryKey, [])

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
        <AccessContext value={waiter}>
          <MemoryRouter>
            <FloorMap />
          </MemoryRouter>
        </AccessContext>
      </QueryClientProvider>,
    )
  })
  return container
}

test('touching a table opens its summary below the floor, so no table moves under the finger', async () => {
  const container = await renderFloor()
  const plan = container.querySelector('[aria-label="Plano desplazable del sector"]')!
  const table = container.querySelector<HTMLButtonElement>('[data-table-id="table-1"]')!

  await act(async () => table.click())

  const summary = container.querySelector('[role="region"][aria-label="Resumen de Mesa 1"]')
  assert.ok(summary, 'The summary opens')
  // Nada se inserta antes del plano: si no, lo empuja y el segundo clic de un doble
  // clic cae en otro lugar.
  assert.equal(plan.parentElement!.firstElementChild, plan)
  assert.ok(plan.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(table.getAttribute('aria-pressed'), 'true')
})

test('closing the floating summary gives focus back to its table', async () => {
  const container = await renderFloor()
  const table = container.querySelector<HTMLButtonElement>('[data-table-id="table-1"]')!
  await act(async () => table.click())

  const close = container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar resumen de Mesa 1"]')!
  await act(async () => close.click())

  assert.equal(container.querySelector('[role="region"]'), null)
  assert.equal(table.getAttribute('aria-pressed'), 'false')
  assert.equal(document.activeElement, table)
})

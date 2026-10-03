// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@restaurant-platform/ui'
import { FloorPlanPage } from '../src/pages/FloorPlanPage'
import { branchesQuery } from '../src/queries/branches'
import { sectionsQuery, tablesQuery } from '../src/queries/floor'
import { RestaurantContext, type Membership } from '../src/restaurant/restaurant-context'

// Sin red: la página lee de una caché sembrada.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const restaurantId = 'restaurant-1'
const membership = { restaurant: { id: restaurantId, name: 'La Esquina' }, role: 'owner' } as Membership

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

/**
 * El Salón de un restaurante con dos sucursales, abierto en `url` después de
 * pasar por Productos: así se ve adónde lleva «atrás».
 */
async function openFloor(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(branchesQuery(restaurantId).queryKey, [
    { id: 'centro', name: 'Centro', is_active: true },
    { id: 'norte', name: 'Norte', is_active: true },
  ] as never)
  client.setQueryData(sectionsQuery('centro').queryKey, [
    { id: 'salon', name: 'Salón', branch_id: 'centro', is_active: true },
    { id: 'terraza', name: 'Terraza', branch_id: 'centro', is_active: true },
  ] as never)
  client.setQueryData(sectionsQuery('norte').queryKey, [
    { id: 'patio', name: 'Patio', branch_id: 'norte', is_active: true },
    { id: 'barra', name: 'Barra', branch_id: 'norte', is_active: true },
  ] as never)
  for (const branch of ['centro', 'norte']) client.setQueryData(tablesQuery(branch).queryKey, [])

  const router = createMemoryRouter(
    [
      { path: '/productos', element: <p>Productos</p> },
      { path: '/salon', element: <FloorPlanPage /> },
    ],
    { initialEntries: ['/productos', url] },
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RestaurantContext value={membership}>
            <RouterProvider router={router} />
          </RestaurantContext>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  )
  return { container, router }
}

/** El botón apretado de un grupo («Modo del plano», «Sectores»), por su texto. */
const pressedIn = (container: HTMLElement, group: string) =>
  container.querySelector(`[role="group"][aria-label="${group}"] button[aria-pressed="true"]`)?.textContent ?? ''

/** Aprieta el botón de un grupo cuyo texto empieza con `name` (los sectores suman la cantidad de mesas). */
async function choose(container: HTMLElement, group: string, name: string) {
  const buttons = container.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)
  await act(async () => [...buttons].find((button) => button.textContent?.startsWith(name))!.click())
}

const branchSelect = (container: HTMLElement) =>
  container.querySelector<HTMLSelectElement>('select[aria-label="Sucursal"]')!

async function chooseBranch(container: HTMLElement, branchId: string) {
  const select = branchSelect(container)
  await act(async () => {
    select.value = branchId
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Lo elegido, tal como quedó en la URL. */
const searchOf = (router: ReturnType<typeof createMemoryRouter>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search))

test('a link opens the Salón where it points: mode, branch and sector', async () => {
  const { container } = await openFloor('/salon?modo=editar&sucursal=norte&sector=barra')

  assert.equal(pressedIn(container, 'Modo del plano'), 'Editar')
  assert.equal(branchSelect(container).value, 'norte')
  assert.match(pressedIn(container, 'Sectores'), /^Barra/)
})

test('choosing a mode or a sector writes it in the URL without piling up history: back leaves the Salón', async () => {
  const { container, router } = await openFloor('/salon')
  assert.equal(pressedIn(container, 'Modo del plano'), 'Vista')
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)

  // Cada elección conserva las otras.
  await choose(container, 'Sectores', 'Terraza')
  assert.deepEqual(searchOf(router), { sector: 'terraza' })
  assert.match(pressedIn(container, 'Sectores'), /^Terraza/)
  await choose(container, 'Modo del plano', 'Editar')
  assert.deepEqual(searchOf(router), { sector: 'terraza', modo: 'editar' })
  await choose(container, 'Sectores', 'Salón')
  assert.deepEqual(searchOf(router), { sector: 'salon', modo: 'editar' })
  assert.equal(pressedIn(container, 'Modo del plano'), 'Editar')
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)

  assert.equal(router.state.historyAction, 'REPLACE')
  await act(() => router.navigate(-1))
  assert.equal(router.state.location.pathname, '/productos')
})

test('a link to a mode, branch or sector that isn’t there opens Vista, the first branch and its first sector', async () => {
  const { container } = await openFloor('/salon?modo=otro&sucursal=cerrada&sector=borrado')

  assert.equal(pressedIn(container, 'Modo del plano'), 'Vista')
  assert.equal(branchSelect(container).value, 'centro')
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)
})

test('choosing another branch writes it and drops the sector, which was the other branch’s', async () => {
  const { container, router } = await openFloor('/salon?modo=editar&sector=terraza')
  assert.match(pressedIn(container, 'Sectores'), /^Terraza/)

  await chooseBranch(container, 'norte')

  assert.deepEqual(searchOf(router), { modo: 'editar', sucursal: 'norte' })
  assert.equal(router.state.historyAction, 'REPLACE')
  assert.match(pressedIn(container, 'Sectores'), /^Patio/)
})

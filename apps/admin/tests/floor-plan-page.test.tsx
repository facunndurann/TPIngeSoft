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
import { saveFloor, sectionsQuery, tablesQuery } from '../src/queries/floor'
import { RestaurantContext, type Membership } from '../src/restaurant/restaurant-context'

// Sin red: la página lee de una caché sembrada, y guardar el salón lo decide cada prueba.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock(import('../src/queries/floor'), async (importOriginal) => ({
  ...(await importOriginal()),
  saveFloor: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const restaurantId = 'restaurant-1'
const membership = { restaurant: { id: restaurantId, name: 'La Esquina' }, role: 'owner' } as Membership

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(saveFloor).mockReset()
})

/** La única mesa: en el Salón de Centro, en el origen del plano. */
const mesa = {
  id: 'mesa-1',
  label: 'Mesa 1',
  section_id: 'salon',
  seats: 4,
  shape: 'rect',
  position_x: 0,
  position_y: 0,
  width: 2,
  height: 2,
  is_active: true,
  is_visible: true,
  qr_token: 'token-mesa-1',
}

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
  client.setQueryData(tablesQuery('centro').queryKey, [mesa] as never)
  client.setQueryData(tablesQuery('norte').queryKey, [])

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

/** El botón de `root` cuyo texto es `name`. */
const buttonNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === name)

async function click(button: HTMLButtonElement | undefined) {
  assert.ok(button, 'El botón existe')
  await act(async () => button.click())
}

/** La mesa del plano, que editando es un botón que se mueve con las flechas. */
const planTable = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-floor-viewport] button[aria-label^="Mesa 1,"]')!

/** Lo elegido, tal como quedó en la URL. */
const searchOf = (router: ReturnType<typeof createMemoryRouter>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search))

test('a link opens the Salón where it points: mode, branch and sector', async () => {
  const view = await openFloor('/salon?sucursal=norte&sector=barra')
  assert.equal(branchSelect(view.container).value, 'norte')
  assert.match(pressedIn(view.container, 'Sectores'), /^Barra/)
  assert.ok(buttonNamed(view.container, 'Editar'))

  // Editando: el mismo sector, con Guardar y Cancelar en lugar de Editar, y sin
  // elegir sucursal (lo que se edita es el salón de una).
  const edit = await openFloor('/salon?modo=editar&sucursal=norte&sector=barra')
  assert.match(pressedIn(edit.container, 'Sectores'), /^Barra/)
  assert.ok(buttonNamed(edit.container, 'Guardar') && buttonNamed(edit.container, 'Cancelar'))
  // Comparar nodos con `equal` imprime el DOM entero si falla: se comparan booleanos.
  assert.ok(!buttonNamed(edit.container, 'Editar'), 'Editando no hay «Editar»')
  assert.ok(!edit.container.querySelector('select[aria-label="Sucursal"]'), 'Editando no se elige sucursal')
})

test('entering edit mode or choosing a sector writes it in the URL without piling up history: back leaves the Salón', async () => {
  const { container, router } = await openFloor('/salon')
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)

  // Cada elección conserva las otras.
  await choose(container, 'Sectores', 'Terraza')
  assert.deepEqual(searchOf(router), { sector: 'terraza' })
  assert.match(pressedIn(container, 'Sectores'), /^Terraza/)
  await click(buttonNamed(container, 'Editar'))
  assert.deepEqual(searchOf(router), { sector: 'terraza', modo: 'editar' })
  await choose(container, 'Sectores', 'Salón')
  assert.deepEqual(searchOf(router), { sector: 'salon', modo: 'editar' })
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)

  assert.equal(router.state.historyAction, 'REPLACE')
  await act(() => router.navigate(-1))
  assert.equal(router.state.location.pathname, '/productos')
})

test('a link to a mode, branch or sector that isn’t there opens Vista, the first branch and its first sector', async () => {
  const { container } = await openFloor('/salon?modo=otro&sucursal=cerrada&sector=borrado')

  assert.ok(buttonNamed(container, 'Editar'))
  assert.equal(branchSelect(container).value, 'centro')
  assert.match(pressedIn(container, 'Sectores'), /^Salón/)
})

test('choosing another branch writes it and drops the sector, which was the other branch’s', async () => {
  const { container, router } = await openFloor('/salon?sector=terraza')
  assert.match(pressedIn(container, 'Sectores'), /^Terraza/)

  await chooseBranch(container, 'norte')

  assert.deepEqual(searchOf(router), { sucursal: 'norte' })
  assert.equal(router.state.historyAction, 'REPLACE')
  assert.match(pressedIn(container, 'Sectores'), /^Patio/)
})

test('editing writes nothing until Guardar: Cancelar asks and discards, Guardar sends only what changed and goes back to Vista', async () => {
  vi.mocked(saveFloor).mockResolvedValue(undefined)
  const { container, router } = await openFloor('/salon')
  const nudgeRight = () =>
    act(async () =>
      planTable(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )

  await click(buttonNamed(container, 'Editar'))
  assert.equal(buttonNamed(container, 'Guardar')!.disabled, true, 'Sin cambios no hay nada que guardar')

  // Deshacer vuelve al salón como estaba: tampoco hay nada que guardar.
  await nudgeRight()
  assert.equal(planTable(container).style.left, '47px')
  await click(container.querySelector<HTMLButtonElement>('button[aria-label="Deshacer"]')!)
  assert.equal(planTable(container).style.left, '3px')
  assert.equal(buttonNamed(container, 'Guardar')!.disabled, true)

  // Con cambios, cancelar pregunta antes de descartarlos.
  await nudgeRight()
  await click(buttonNamed(container, 'Cancelar'))
  const dialog = container.querySelector('dialog')!
  assert.match(dialog.textContent ?? '', /¿Descartar los cambios\?/)
  await click(buttonNamed(dialog, 'Descartar cambios'))
  assert.equal(searchOf(router).modo, 'vista')
  assert.equal(vi.mocked(saveFloor).mock.calls.length, 0)

  // De nuevo a editar: el borrador descartado no quedó. Se mueve la mesa y se guarda.
  await click(buttonNamed(container, 'Editar'))
  assert.equal(planTable(container).style.left, '3px')
  await nudgeRight()
  await click(buttonNamed(container, 'Guardar'))
  await vi.waitFor(() => assert.equal(searchOf(router).modo, 'vista'))
  assert.deepEqual(vi.mocked(saveFloor).mock.calls, [
    [
      'centro',
      {
        sections: { create: [], update: [], delete: [] },
        tables: { create: [], update: [{ id: 'mesa-1', position_x: 1 }], delete: [] },
      },
    ],
  ])
})

test('in Vista, tapping a table on the plan, or its row in the list, shows its QR, as in Mesas y QR', async () => {
  const { container } = await openFloor('/salon')
  const qrTitle = () => container.querySelector('dialog h2')?.textContent

  // Sin medir el recuadro, la cámara arranca en (28, 28) a tamaño real: la mesa
  // de 2 × 2 en el origen ocupa de 28 a 116 px.
  const tile = [...container.querySelectorAll('[data-floor-viewport] span')].find(
    (span) => span.textContent === 'Mesa 1',
  )!
  await act(async () => {
    for (const type of ['pointerdown', 'pointerup']) {
      tile.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: 60, clientY: 60 }))
    }
  })
  assert.equal(qrTitle(), 'QR de Mesa 1')
  assert.match(container.querySelector('dialog code')?.textContent ?? '', /\/m\/token-mesa-1$/)

  await act(async () => container.querySelector<HTMLButtonElement>('dialog button[aria-label="Cerrar"]')!.click())
  assert.equal(container.querySelector('dialog'), null)

  // Con el teclado o un lector de pantalla, la mesa del plano y la fila de la lista llevan al mismo QR.
  const plan = container.querySelector<HTMLButtonElement>('[data-floor-viewport] button[aria-label^="Mesa 1,"]')!
  await act(async () => plan.click())
  assert.equal(qrTitle(), 'QR de Mesa 1')
  await act(async () => container.querySelector<HTMLButtonElement>('dialog button[aria-label="Cerrar"]')!.click())

  const row = [...container.querySelectorAll<HTMLButtonElement>('aside li button')].find((button) =>
    button.textContent?.startsWith('Mesa 1'),
  )!
  await act(async () => row.click())
  assert.equal(qrTitle(), 'QR de Mesa 1')
})

// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
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

/**
 * El plano con una mesa libre de 2 × 2 en el origen, ya cargado y sin releer: la
 * prueba no depende de la red. La comanda es otra ruta, para ver cuándo se abre.
 */
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
          <MemoryRouter initialEntries={['/salon']}>
            <Routes>
              <Route path="/salon" element={<FloorMap />} />
              <Route path="/salon/:tableId" element={<p>Comanda abierta</p>} />
            </Routes>
          </MemoryRouter>
        </AccessContext>
      </QueryClientProvider>,
    )
  })
  const viewport = container.querySelector<HTMLElement>('[data-floor-viewport]')!
  return {
    container,
    viewport,
    plan: container.querySelector('section[aria-labelledby="floor-map-heading"]')!,
    table: container.querySelector<HTMLButtonElement>('[data-table-id="table-1"]')!,
    summary: () => container.querySelector('[role="region"][aria-label="Resumen de Mesa 1"]'),
  }
}

/** Un puntero (mouse o dedo) que aprieta, se mueve o suelta en un punto de la pantalla. */
async function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }))
  })
}

/**
 * Un toque que no mueve el plano. Sin medir el recuadro, la cámara arranca en
 * (28, 28) a tamaño real: la mesa de 2 × 2 en el origen ocupa de 28 a 116 px.
 */
async function tap(target: Element, x = 60, y = 60) {
  await pointer(target, 'pointerdown', x, y)
  await pointer(target, 'pointerup', x, y)
}

test('the POS draws the same floor as the admin: checkered, endless, with chairs and the zoom slider', async () => {
  const { container, viewport, table } = await renderFloor()

  // Un dedo arrastra el plano y dos lo pellizcan: los gestos son todos del recuadro.
  assert.match(viewport.className, /\btouch-none\b/)
  assert.match(viewport.style.backgroundImage, /conic-gradient/)
  assert.ok(container.querySelector('input[type="range"][aria-label="Zoom"]'))
  assert.ok([...container.querySelectorAll('button')].some((button) => button.textContent === 'Ajustar al salón'))

  // Una silla por lugar, alrededor de la mesa, y la leyenda que lo explica.
  const chairs = [...table.parentElement!.children].filter((element) => element.matches('span.rounded-full'))
  assert.equal(chairs.length, 4)
  assert.match(container.textContent ?? '', /Cada silla es un lugar/)
})

test('a tap on a table shows its summary below the floor, so no table moves under the finger; a tap on the empty floor closes it', async () => {
  const { viewport, plan, table, summary } = await renderFloor()

  await tap(table)

  assert.ok(summary(), 'The summary opens')
  // Nada se inserta antes del plano: si no, lo empuja y el segundo toque cae en otro lugar.
  assert.equal(plan.parentElement!.firstElementChild, plan)
  assert.ok(plan.compareDocumentPosition(summary()!) & Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(table.getAttribute('aria-pressed'), 'true')

  await tap(viewport, 300, 300)
  assert.ok(!summary(), 'Un toque en el piso vacío cierra el resumen')
})

test('two taps in a row on a table open its command, as a double click did', async () => {
  const { container, table } = await renderFloor()

  await tap(table)
  await tap(table)

  assert.match(container.textContent ?? '', /Comanda abierta/)
})

test('dragging the floor from a table moves the plan and doesn’t choose the table', async () => {
  const { viewport, table, summary } = await renderFloor()
  const layer = viewport.firstElementChild as HTMLElement
  const before = layer.style.transform

  await pointer(table, 'pointerdown', 60, 60)
  await pointer(table, 'pointermove', 100, 80)
  await pointer(table, 'pointerup', 100, 80)

  assert.notEqual(layer.style.transform, before)
  assert.ok(!summary(), 'Arrastrar no elige la mesa')
})

test('the keyboard chooses a table with its own click, and twice in a row opens its command; the click a finger also fires there doesn’t count twice', async () => {
  const { container, table, summary } = await renderFloor()

  // El de un toque trae `detail` 1: ese ya lo resolvió el plano.
  await act(async () => table.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  assert.ok(!summary(), 'El clic de un toque no elige dos veces')

  // Enter o Espacio sobre la mesa, o un lector de pantalla: un clic sin puntero.
  await act(async () => table.click())
  assert.ok(summary())

  // Es un toque más: dos seguidos sobre la misma mesa abren su comanda.
  await act(async () => table.click())
  assert.match(container.textContent ?? '', /Comanda abierta/)
})

test('a second tap too late, or a tap on the floor in between, only chooses the table', async () => {
  const { container, viewport, table, summary } = await renderFloor()
  const clock = vi.spyOn(performance, 'now')
  try {
    // A los 600 ms ya no es doble; y el piso, en el medio, corta la cuenta.
    for (const [at, target] of [
      [0, table],
      [600, table],
      [700, viewport],
      [800, table],
    ] as const) {
      clock.mockReturnValue(at)
      await (target === viewport ? tap(viewport, 300, 300) : tap(table))
    }
    assert.ok(summary(), 'La mesa queda elegida')
    assert.doesNotMatch(container.textContent ?? '', /Comanda abierta/)
  } finally {
    clock.mockRestore()
  }
})

test('closing the floating summary gives focus back to its table', async () => {
  const { container, table } = await renderFloor()
  await act(async () => table.click())

  const close = container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar resumen de Mesa 1"]')!
  await act(async () => close.click())

  // Comparar nodos con `equal` imprime el DOM entero si falla: se comparan booleanos.
  assert.ok(!container.querySelector('[role="region"]'), 'El resumen se cerró')
  assert.equal(table.getAttribute('aria-pressed'), 'false')
  assert.ok(document.activeElement === table, 'El foco volvió a la mesa')
})

test('a table’s text never reads under 12px on screen, even fully zoomed out', async () => {
  const { container, table } = await renderFloor()
  const slider = container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Zoom"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '30')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })

  const name = table.querySelector<HTMLElement>('span[title="Mesa 1"]')!
  assert.ok(parseFloat(name.style.fontSize) * 0.3 >= 12 - 1e-9, `${name.style.fontSize} a 30 %`)
})

// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Placed } from '@restaurant-platform/shared'
import { FloorCanvas, type FloorEditing } from '../src/features/floor/FloorCanvas'
import { useFloorCamera } from '../src/features/floor/useFloorCamera'
import type { FloorTable } from '../src/queries/floor'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const table = {
  id: 'table-a',
  label: 'Mesa 1',
  seats: 4,
  shape: 'square',
  position_x: 0,
  position_y: 0,
  width: 2,
  height: 2,
  is_active: true,
  is_visible: true,
} as FloorTable

/** El plano con su cámara, como lo arman el editor y la vista. */
function Plan({ tables = [table], editing }: { tables?: FloorTable[]; editing?: FloorEditing }) {
  const camera = useFloorCamera(tables)
  return <FloorCanvas tables={tables} camera={camera} editing={editing} />
}

/** Un editor que anota lo que se elige y lo que se propone, sin escribir nada. */
function recorder(selectedId: string | null) {
  const selections: (string | null)[] = []
  const placements: Placed[] = []
  const editing: FloorEditing = {
    selectedId,
    onSelect: (id) => selections.push(id),
    onPlace: (_table, placed) => placements.push(placed),
  }
  return { editing, selections, placements }
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

async function mount(node: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(node))
  const viewport = container.querySelector<HTMLElement>('[data-floor-viewport]')!
  return { container, viewport, layer: viewport.firstElementChild as HTMLElement }
}

/** Un puntero que aprieta, se mueve o suelta en un punto de la pantalla. */
async function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x = 0, y = 0) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }))
  })
}

/** Dónde dibuja la cámara la celda (0, 0), y con qué zoom. */
function cameraOf(layer: HTMLElement) {
  const [, x, y, zoom] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(layer.style.transform)!
  return { x: Number(x), y: Number(y), zoom: Number(zoom) }
}

const tableButton = (container: HTMLElement) => container.querySelector('button[aria-label^="Mesa 1,"]')!

/** Las clases del elemento cuya apertura cumple `pattern`. */
const classOf = (html: string, pattern: RegExp) => /class="([^"]*)"/.exec(pattern.exec(html)?.[0] ?? '')?.[1] ?? ''

test('the floor owns every touch gesture: one finger moves it, two pinch it', () => {
  // Sin bordes no hay scroll nativo que desplace: el recuadro toma los toques y
  // los traduce a la cámara, en los dos modos.
  for (const editing of [recorder(table.id).editing, undefined]) {
    const html = renderToStaticMarkup(<Plan editing={editing} />)
    assert.match(classOf(html, /<div data-floor-viewport="true" class="[^"]*"/), /\btouch-none\b/)
  }
})

test('a press on a table is the table’s: it chooses it, and the floor neither moves nor lets it go', async () => {
  const { editing, selections } = recorder(null)
  const { container, layer } = await mount(<Plan editing={editing} />)
  const before = cameraOf(layer)

  await pointer(tableButton(container), 'pointerdown')
  await pointer(tableButton(container), 'pointerup')

  assert.deepEqual(selections, ['table-a'])
  assert.deepEqual(cameraOf(layer), before)
})

test('dragging a table proposes where it was dropped', async () => {
  const { editing, placements } = recorder(table.id)
  const { container, layer } = await mount(<Plan editing={editing} />)
  const cell = 44 * cameraOf(layer).zoom

  await pointer(tableButton(container), 'pointerdown', 10, 10)
  await pointer(tableButton(container), 'pointermove', 10 + cell * 3, 10 - cell)
  await pointer(tableButton(container), 'pointerup', 10 + cell * 3, 10 - cell)

  assert.deepEqual(placements, [{ x: 3, y: -1, footprint: { w: 2, h: 2 } }])
})

test('a tap on the empty floor lets the chosen table go; dragging the floor moves the plan and keeps it', async () => {
  const { editing, selections } = recorder(table.id)
  const { viewport, layer } = await mount(<Plan editing={editing} />)
  const before = cameraOf(layer)

  await pointer(viewport, 'pointerdown', 10, 10)
  await pointer(viewport, 'pointermove', 50, 35)
  await pointer(viewport, 'pointerup', 50, 35)
  assert.deepEqual(selections, [])
  assert.deepEqual(cameraOf(layer), { ...before, x: before.x + 40, y: before.y + 25 })

  await pointer(viewport, 'pointerdown', 50, 35)
  await pointer(viewport, 'pointerup', 50, 35)
  assert.deepEqual(selections, [null])
})

test('with Space held, a press over a table grabs the floor instead', async () => {
  const { editing, selections } = recorder(null)
  const { container, viewport, layer } = await mount(<Plan editing={editing} />)
  const before = cameraOf(layer)
  await act(async () => {
    viewport.dispatchEvent(new PointerEvent('pointerenter'))
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
  })

  await pointer(tableButton(container), 'pointerdown', 0, 0)
  await pointer(tableButton(container), 'pointermove', 20, 0)
  await pointer(tableButton(container), 'pointerup', 20, 0)

  // Ni se eligió la mesa ni se soltó nada: se movió el plano.
  assert.deepEqual(selections, [])
  assert.deepEqual(cameraOf(layer), { ...before, x: before.x + 20 })
})

test('in view mode a table doesn’t grab the finger: dragging over it moves the floor', async () => {
  const { container, layer } = await mount(<Plan />)
  const tile = [...container.querySelectorAll('span')].find((span) => span.textContent === 'Mesa 1')!.parentElement!
  const before = cameraOf(layer)

  await pointer(tile, 'pointerdown', 0, 0)
  await pointer(tile, 'pointermove', 0, 30)
  await pointer(tile, 'pointerup', 0, 30)

  assert.equal(container.querySelector('button[aria-label^="Mesa 1,"]'), null)
  assert.deepEqual(cameraOf(layer), { ...before, y: before.y + 30 })
})

test('a table left of or above the origin is drawn there: the camera, not the floor, brings it into view', () => {
  const far = { ...table, id: 'table-far', label: 'Mesa lejos', position_x: -2, position_y: -1 } as FloorTable
  const html = renderToStaticMarkup(<Plan tables={[far]} />)
  // 44px por celda, y 3px de aire a cada lado entre mesas vecinas.
  assert.match(html, /style="left:-85px;top:-41px;width:82px;height:82px/)
})

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
function Plan({
  tables = [table],
  editing,
  onOpenTable,
}: {
  tables?: FloorTable[]
  editing?: FloorEditing
  onOpenTable?: (table: FloorTable) => void
}) {
  const camera = useFloorCamera(tables)
  return <FloorCanvas tables={tables} camera={camera} editing={editing} onOpenTable={onOpenTable} />
}

/** Un editor que anota lo que se elige y lo que se propone, sin escribir nada. */
function recorder(selectedId: string | null) {
  const selections: (string | null)[] = []
  const placements: Placed[] = []
  const editing: FloorEditing = {
    selectedId,
    onSelect: (id) => selections.push(id),
    onPlace: (_table, placed) => placements.push(placed),
    refusal: null,
    onRefusalShown: () => {},
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
  const render = (next: ReactNode) => act(async () => root.render(next))
  await render(node)
  const viewport = container.querySelector<HTMLElement>('[data-floor-viewport]')!
  return { container, viewport, layer: viewport.firstElementChild as HTMLElement, render }
}

/** Un puntero que aprieta, se mueve o suelta en un punto de la pantalla; por defecto, con el botón principal. */
async function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x = 0, y = 0, button = 0) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button, clientX: x, clientY: y }))
  })
}

/** Dónde dibuja la cámara la celda (0, 0), y con qué zoom. */
function cameraOf(layer: HTMLElement) {
  const [, x, y, zoom] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(layer.style.transform)!
  return { x: Number(x), y: Number(y), zoom: Number(zoom) }
}

const tableButton = (container: HTMLElement) => container.querySelector('button[aria-label^="Mesa 1,"]')!

/** Las marcas de «no entra» del plano: cada una, la ✕ y el borde que la rodea. */
const noFitMarks = (container: HTMLElement) =>
  [...container.querySelectorAll('svg.lucide-x')].map((icon) => icon.parentElement!)

/** Otra mesa, cuatro celdas a la derecha de la primera. */
const neighbor = { ...table, id: 'table-b', label: 'Mesa 2', position_x: 4 } as FloorTable

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

test('in view mode a tap opens the table under it, even if the finger slips a little; a drag, the empty floor or the middle button open nothing', async () => {
  const opened: string[] = []
  const { container, viewport } = await mount(<Plan onOpenTable={(entry) => opened.push(entry.id)} />)
  const tile = [...container.querySelectorAll('span')].find((span) => span.textContent === 'Mesa 1')!.parentElement!
  assert.match(tile.className, /\bcursor-pointer\b/)

  // Sin medir el recuadro, la cámara arranca en (28, 28) a tamaño real: la mesa
  // de 2 × 2 en (0, 0) ocupa de 28 a 116 px. Un dedo que se corre 6 px sigue tocando.
  await pointer(tile, 'pointerdown', 60, 60)
  await pointer(tile, 'pointermove', 65, 63)
  await pointer(tile, 'pointerup', 65, 63)
  assert.deepEqual(opened, ['table-a'])

  // Más allá de la tolerancia es un arrastre: mueve el plano y no abre la mesa.
  await pointer(tile, 'pointerdown', 60, 60)
  await pointer(tile, 'pointermove', 70, 60)
  await pointer(tile, 'pointerup', 70, 60)
  await pointer(viewport, 'pointerdown', 300, 300)
  await pointer(viewport, 'pointerup', 300, 300)
  await pointer(tile, 'pointerdown', 60, 60, 1)
  await pointer(tile, 'pointerup', 60, 60, 1)
  assert.deepEqual(opened, ['table-a'])
})

test('a table that the plan can’t open doesn’t look clickable', async () => {
  const { container } = await mount(<Plan />)
  const tile = [...container.querySelectorAll('span')].find((span) => span.textContent === 'Mesa 1')!.parentElement!
  assert.doesNotMatch(tile.className, /\bcursor-pointer\b/)
})

test('tapping a corner handle without dragging grows the table one cell toward that corner', async () => {
  const { editing, placements } = recorder(table.id)
  const { container } = await mount(<Plan editing={editing} />)
  const handle = (cursor: string) => container.querySelector(`span.${cursor}`)!

  await pointer(handle('cursor-se-resize'), 'pointerdown')
  await pointer(handle('cursor-se-resize'), 'pointerup')
  await pointer(handle('cursor-nw-resize'), 'pointerdown')
  await pointer(handle('cursor-nw-resize'), 'pointerup')

  // La mesa de 2 × 2 en (0, 0): hacia abajo a la derecha crece sin moverse; hacia
  // arriba a la izquierda, la esquina opuesta queda quieta.
  assert.deepEqual(placements, [
    { x: 0, y: 0, footprint: { w: 3, h: 3 } },
    { x: -1, y: -1, footprint: { w: 3, h: 3 } },
  ])
})

test('corner handles stay at least 24px on screen, even fully zoomed out', async () => {
  const { editing } = recorder(table.id)
  const { container, layer } = await mount(<Plan editing={editing} />)
  const onScreen = () => {
    const handle = container.querySelector<HTMLElement>('span.cursor-se-resize')!
    return parseFloat(handle.style.width) * cameraOf(layer).zoom
  }

  assert.ok(onScreen() >= 24, `a zoom 1: ${onScreen()}px`)
  const zoomOut = [...container.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Alejar')!
  while (!zoomOut.disabled) await act(async () => zoomOut.click())
  assert.ok(onScreen() >= 24 - 1e-9, `al ${Math.round(cameraOf(layer).zoom * 100)} %: ${onScreen()}px`)
})

test('buttons and framing glide the camera; gestures move it right away; opening the floor does not animate', async () => {
  // happy-dom no avisa cuando cambia un tamaño: este observador avisa apenas
  // observa, como el navegador la primera vez, para que haya encuadre.
  const RealObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    readonly onResize: ResizeObserverCallback
    constructor(onResize: ResizeObserverCallback) {
      this.onResize = onResize
    }
    observe() {
      this.onResize([], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  try {
    const { container, viewport, layer } = await mount(<Plan editing={recorder(table.id).editing} />)
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find(
        (entry) => entry.getAttribute('aria-label') === label || entry.textContent === label,
      )!
    // La capa de las mesas y el damero del fondo se deslizan juntos, o ninguno.
    const glides = () => {
      const tables = layer.className.includes('motion-safe:transition-transform')
      const floor = viewport.className.includes('motion-safe:transition-[background-position,background-size]')
      assert.equal(tables, floor)
      return tables
    }

    assert.equal(glides(), false, 'al abrir, el primer encuadre aparece de una')
    await act(async () => button('Acercar').click())
    assert.equal(glides(), true, 'el zoom de los botones se desliza')
    await pointer(viewport, 'pointerdown', 10, 10)
    await pointer(viewport, 'pointermove', 40, 10)
    await pointer(viewport, 'pointerup', 40, 10)
    assert.equal(glides(), false, 'arrastrar el piso lo mueve al instante')
    await act(async () => button('Ajustar al salón').click())
    assert.equal(glides(), true, '«Ajustar al salón» se desliza')
  } finally {
    globalThis.ResizeObserver = RealObserver
  }
})

test('dragging a table onto another marks it with an ✕ and a dashed border, not only in red, while it stays there', async () => {
  const { editing } = recorder(table.id)
  const { container, layer } = await mount(<Plan tables={[table, neighbor]} editing={editing} />)
  const cell = 44 * cameraOf(layer).zoom
  assert.equal(noFitMarks(container).length, 0)

  await pointer(tableButton(container), 'pointerdown', 10, 10)
  await pointer(tableButton(container), 'pointermove', 10 + cell * 3, 10)
  const [mark, ...others] = noFitMarks(container)
  assert.equal(others.length, 0)
  assert.match(mark.className, /\bborder-dashed\b/)
  // Sigue a la mesa, quieta: se sacude solo cuando se la quiso dejar ahí.
  assert.equal(mark.style.left, '135px')
  assert.doesNotMatch(mark.className, /animate-refuse/)

  await pointer(tableButton(container), 'pointermove', 10 + cell * 6, 10)
  assert.equal(noFitMarks(container).length, 0, 'en un lugar libre, la marca se va')
})

test('a table that didn’t fit is marked on itself: it shakes unless motion is reduced, goes once seen, and each refusal starts over', async () => {
  let shown = 0
  const refusedTwice = (key: number): FloorEditing => ({
    ...recorder(null).editing,
    refusal: { tableId: neighbor.id, key },
    onRefusalShown: () => {
      shown += 1
    },
  })
  const { container, render } = await mount(<Plan tables={[table, neighbor]} editing={refusedTwice(1)} />)

  // Sobre la que no entró y no sobre la otra: 4 celdas de 44 px, más 3 px de aire.
  const [mark, ...others] = noFitMarks(container)
  assert.equal(others.length, 0)
  assert.equal(mark.style.left, '179px')
  assert.match(mark.className, /\bborder-dashed\b/)
  assert.match(mark.className, /(^| )motion-safe:animate-refuse( |$)/)
  assert.match(mark.className, /(^| )motion-reduce:animate-refuse-still( |$)/)

  await act(async () => mark.dispatchEvent(new Event('animationend', { bubbles: true })))
  assert.equal(shown, 1, 'cuando termina de verse, quien edita lo olvida')

  // La misma mesa, otra vez contra la otra: una marca nueva, que vuelve a sacudirse.
  await render(<Plan tables={[table, neighbor]} editing={refusedTwice(2)} />)
  assert.notEqual(noFitMarks(container)[0], mark)
})

test('a table left of or above the origin is drawn there: the camera, not the floor, brings it into view', () => {
  const far = { ...table, id: 'table-far', label: 'Mesa lejos', position_x: -2, position_y: -1 } as FloorTable
  const html = renderToStaticMarkup(<Plan tables={[far]} />)
  // 44px por celda, y 3px de aire a cada lado entre mesas vecinas.
  assert.match(html, /style="left:-85px;top:-41px;width:82px;height:82px/)
})

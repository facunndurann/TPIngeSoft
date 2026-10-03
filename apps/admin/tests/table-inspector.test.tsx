// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Placed } from '@restaurant-platform/shared'
import { TableInspector } from '../src/features/floor/TableInspector'
import type { FloorTable } from '../src/queries/floor'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const table = {
  id: 'table-a',
  label: 'Mesa 1',
  seats: 4,
  shape: 'rect',
  section_id: 'section-a',
  position_x: 2,
  position_y: 3,
  width: 3,
  height: 1,
  is_active: true,
  is_visible: true,
} as FloorTable

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

/** El panel de la mesa, anotando lo que proponen sus flechas. */
async function mount() {
  const placements: Placed[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const noop = () => {}
  await act(async () =>
    root.render(
      <TableInspector
        table={table}
        sectionName="Salón"
        onEdit={noop}
        onPlace={(placed) => placements.push(placed)}
        onDelete={noop}
        onClose={noop}
        busy={false}
      />,
    ),
  )
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label)!
  return { container, placements, button }
}

test('without dragging or a keyboard, the panel arrows move the table one cell', async () => {
  const { placements, button } = await mount()
  await act(async () => button('Mover a la derecha').click())
  await act(async () => button('Mover hacia arriba').click())
  assert.deepEqual(placements, [
    { x: 3, y: 3, footprint: { w: 3, h: 1 } },
    { x: 2, y: 2, footprint: { w: 3, h: 1 } },
  ])
})

test('the fifth button makes the arrows stretch, like Shift, and an arrow that would do nothing is off', async () => {
  const { container, placements, button } = await mount()
  const toggle = button('Estirar en lugar de mover')
  await act(async () => toggle.click())

  assert.equal(toggle.getAttribute('aria-pressed'), 'true')
  assert.match(container.textContent ?? '', /Estirar/)
  await act(async () => button('Agrandar el ancho').click())
  assert.deepEqual(placements, [{ x: 2, y: 3, footprint: { w: 4, h: 1 } }])
  // De una celda de alto no se puede achicar más.
  assert.equal(button('Achicar el alto').disabled, true)
})

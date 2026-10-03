import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FLOOR_CELL } from '@restaurant-platform/shared'
import { HOME, ZOOM, cellAt, framing, pinched, zoomedAround } from '../src/features/floor/camera'

const view = { width: 800, height: 400 }
const center = { x: view.width / 2, y: view.height / 2 }

/** Igualdad con decimales: las cuentas de la cámara no son enteras. */
const near = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.y - expected.y) < 1e-9, JSON.stringify({ actual, expected }))
}

test('cellAt turns a point of the box into a cell, whatever the zoom', () => {
  near(cellAt(HOME, { x: HOME.x + FLOOR_CELL * 2.5, y: HOME.y }), { x: 2.5, y: 0 })
  near(cellAt({ x: 0, y: 0, zoom: 0.5 }, { x: 66, y: -22 }), { x: 3, y: -1 })
})

test('zooming keeps still what is under the anchor, and never leaves the zoom range', () => {
  const at = { x: 300, y: 120 }
  const zoomed = zoomedAround(HOME, 1.3, at)
  near(cellAt(zoomed, at), cellAt(HOME, at))
  assert.equal(zoomedAround(HOME, 9, at).zoom, ZOOM.max)
  assert.equal(zoomedAround(HOME, 0.01, at).zoom, ZOOM.min)
})

test('two fingers: the distance between them is the zoom and their midpoint drags', () => {
  // Se separan al doble sin moverse del lugar: lo que hay en el medio queda quieto.
  const spread = pinched(HOME, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 100 }, { x: 250, y: 100 }])
  assert.equal(spread.zoom, 1.5) // el doble de 1 pasa el tope
  near(cellAt(spread, { x: 150, y: 100 }), cellAt(HOME, { x: 150, y: 100 }))

  // Se corren juntos sin separarse: el plano los sigue, sin zoom.
  const dragged = pinched(HOME, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 130, y: 90 }, { x: 230, y: 90 }])
  assert.deepEqual(dragged, { x: HOME.x + 30, y: HOME.y - 10, zoom: 1 })
})

test('framing centers every table in the box, without blowing a small sector up', () => {
  assert.deepEqual(framing([], view), HOME)

  // Una sola mesa: entra de sobra, pero no se agranda más que a tamaño real.
  const lone = framing([{ x: 4, y: -2, footprint: { w: 3, h: 3 } }], view)
  assert.equal(lone.zoom, 1)
  near(cellAt(lone, center), { x: 5.5, y: -0.5 })

  // Un salón enorme se aleja lo que haga falta, hasta el tope.
  const huge = framing([{ x: -100, y: 0, footprint: { w: 3, h: 3 } }, { x: 100, y: 0, footprint: { w: 3, h: 3 } }], view)
  assert.equal(huge.zoom, ZOOM.min)
  near(cellAt(huge, center), { x: 1.5, y: 1.5 })
})

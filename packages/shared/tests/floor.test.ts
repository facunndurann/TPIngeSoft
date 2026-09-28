import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  FLOOR_GRID,
  TABLE_SPAN,
  clampSpan,
  clampToGrid,
  collidesWithAny,
  findFreeCell,
  isOperable,
  occupiedBy,
  resizePlacement,
  tableFootprint,
  tablePlacement,
  tableShapes,
} from '../src/floor.ts'
import { arrayValues, definitionOf } from './schema-snapshot.ts'

const lastColumn = FLOOR_GRID.cols - 3

test('tablePlacement lee la mesa como se dibuja: recortada a la grilla', () => {
  // Guardada más allá del borde, como quedaría si la grilla se achicara.
  const placed = tablePlacement({ position_x: 30, position_y: 2, width: 3, height: 3 })
  assert.deepEqual(placed, { x: lastColumn, y: 2, footprint: { w: 3, h: 3 } })
})

test('occupiedBy choca donde se ve la mesa y no cuenta a la que se mueve', () => {
  const tables = [
    { id: 'fuera', position_x: 30, position_y: 0, width: 3, height: 3 },
    { id: 'movida', position_x: 0, position_y: 0, width: 3, height: 3 },
  ]
  const taken = occupiedBy(tables, 'movida')
  assert.deepEqual(taken, [{ x: lastColumn, y: 0, footprint: { w: 3, h: 3 } }])
  // Con la posición guardada (x = 30) este lugar parecía libre, aunque ahí se ve la mesa.
  assert.equal(collidesWithAny({ x: lastColumn, y: 0, footprint: { w: 3, h: 3 } }, taken), true)
})

test('resizePlacement solo manda columnas de la fila, aunque el intent traiga kind', () => {
  const intent = { kind: 'resize' as const, width: 5, height: 2 }
  const patch = resizePlacement({ position_x: 0, position_y: 0 }, intent)
  assert.deepEqual(Object.keys(patch).sort(), ['height', 'position_x', 'position_y', 'width'])
  assert.equal(patch.width, 5)
  assert.equal(patch.height, 2)
  assert.equal('kind' in patch, false)
})

test('table sizes are free but always drawable inside the grid', () => {
  assert.deepEqual(tableFootprint({ width: 5, height: 2 }), { w: 5, h: 2 })
  assert.deepEqual(tableFootprint({ width: 1, height: 1 }), { w: 1, h: 1 })

  // Datos fuera de rango no rompen el plano: se recortan al dibujar.
  assert.deepEqual(tableFootprint({ width: 0, height: -3 }), {
    w: TABLE_SPAN.min,
    h: TABLE_SPAN.min,
  })
  assert.deepEqual(tableFootprint({ width: 999, height: 999 }), {
    w: TABLE_SPAN.max,
    h: TABLE_SPAN.max,
  })
  assert.equal(clampSpan(3.6, FLOOR_GRID.cols), 4)
  // El límite del eje manda sobre el tope general.
  assert.equal(clampSpan(99, 5), 5)

  const big = tableFootprint({ width: 5, height: 4 })
  assert.deepEqual(clampToGrid(-5, -5, big), { x: 0, y: 0 })
  assert.deepEqual(clampToGrid(999, 999, big), {
    x: FLOOR_GRID.cols - big.w,
    y: FLOOR_GRID.rows - big.h,
  })
  assert.deepEqual(clampToGrid(4.4, 6.6, big), { x: 4, y: 7 })
})

test('tables collide when they overlap and fit when they only touch', () => {
  const footprint = tableFootprint({ width: 3, height: 3 })
  const anchor = { x: 3, y: 3, footprint }

  assert.equal(collidesWithAny({ x: 5, y: 3, footprint }, [anchor]), true)
  // Pegada al borde derecho: comparten borde, no celdas.
  assert.equal(collidesWithAny({ x: 6, y: 3, footprint }, [anchor]), false)
  assert.equal(collidesWithAny({ x: 3, y: 6, footprint }, [anchor]), false)

  // El hueco que propone una mesa nueva nunca pisa a las existentes.
  const taken = [anchor, { x: 0, y: 0, footprint }]
  const free = findFreeCell(footprint, taken)
  assert.equal(collidesWithAny({ ...free, footprint }, taken), false)
})

test('a hidden table, one out of service, or one in a closed section is never operable', () => {
  const open = { is_active: true }
  const closed = { is_active: false }

  assert.equal(isOperable({ is_active: true, is_visible: true }), true)
  assert.equal(isOperable({ is_active: true, is_visible: false }), false)
  assert.equal(isOperable({ is_active: false, is_visible: true }), false)

  // Un sector dado de baja saca de la operación hasta a sus mesas sanas.
  assert.equal(isOperable({ is_active: true, is_visible: true }, open), true)
  assert.equal(isOperable({ is_active: true, is_visible: true }, closed), false)
  assert.equal(isOperable({ is_active: true, is_visible: false }, open), false)

  // Sin sector la mesa sigue siendo operable: existe y tiene QR.
  assert.equal(isOperable({ is_active: true, is_visible: true }, null), true)
})

test('the database accepts exactly the shapes the floor editor offers, and every size it allows', () => {
  const tables = definitionOf('TABLE', 'tables')

  const shapes = tables.match(/CONSTRAINT "tables_shape_valid" CHECK (.*)$/m)
  assert.ok(shapes, 'tables tiene que limitar las formas')
  assert.deepEqual(arrayValues(shapes[1]).sort(), [...tableShapes].sort())

  // El tope de la base no puede quedar por debajo del que ofrece el editor, en ningún eje.
  for (const axis of ['width', 'height']) {
    const range = tables.match(new RegExp(`\\("${axis}" >= (\\d+)\\) AND \\("${axis}" <= (\\d+)\\)`))
    assert.ok(range, `tables tiene que acotar ${axis}`)
    assert.ok(Number(range[1]) <= TABLE_SPAN.min && Number(range[2]) >= TABLE_SPAN.max, axis)
  }
})

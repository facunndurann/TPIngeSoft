import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  FLOOR_BOUNDS,
  TABLE_SPAN,
  clampSpan,
  clampToFloor,
  collidesWithAny,
  covers,
  findFreeCell,
  floorExtent,
  isOperable,
  occupiedBy,
  tableFootprint,
  tablePlacement,
  tableShapes,
} from '../src/floor.ts'
import { arrayValues, definitionOf } from './schema-snapshot.ts'

test('the floor has no edges: a table stays wherever it was put, even left of or above the origin', () => {
  assert.deepEqual(tablePlacement({ position_x: 30, position_y: 2, width: 3, height: 3 }), {
    x: 30,
    y: 2,
    footprint: { w: 3, h: 3 },
  })
  assert.deepEqual(tablePlacement({ position_x: -7, position_y: -40, width: 2, height: 1 }), {
    x: -7,
    y: -40,
    footprint: { w: 2, h: 1 },
  })
  // Solo el rango sano de la base pone un tope, y se redondea a celdas enteras.
  assert.deepEqual(clampToFloor(4.4, -6.6), { x: 4, y: -7 })
  assert.deepEqual(clampToFloor(1e9, -1e9), { x: FLOOR_BOUNDS.max, y: FLOOR_BOUNDS.min })
  assert.deepEqual(clampToFloor(Number.NaN, 2), { x: 0, y: 2 })
})

test('occupiedBy no cuenta a la mesa que se mueve', () => {
  const tables = [
    { id: 'lejos', position_x: 30, position_y: -5, width: 3, height: 3 },
    { id: 'movida', position_x: 0, position_y: 0, width: 3, height: 3 },
  ]
  const taken = occupiedBy(tables, 'movida')
  assert.deepEqual(taken, [{ x: 30, y: -5, footprint: { w: 3, h: 3 } }])
  assert.equal(collidesWithAny({ x: 31, y: -4, footprint: { w: 3, h: 3 } }, taken), true)
})

test('table sizes are free but always valid', () => {
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
  assert.equal(clampSpan(3.6), 4)
})

test('floorExtent is the box around every table, wherever they are', () => {
  assert.equal(floorExtent([]), null)
  const extent = floorExtent([
    { x: -4, y: 2, footprint: { w: 3, h: 3 } },
    { x: 10, y: -1, footprint: { w: 2, h: 1 } },
  ])
  assert.deepEqual(extent, { x: -4, y: -1, w: 16, h: 6 })
})

test('a new table goes to the free spot closest to where it was asked for', () => {
  const footprint = tableFootprint({ width: 3, height: 3 })
  // Libre, va justo ahí, aunque sea lejos del origen.
  assert.deepEqual(findFreeCell(footprint, [], { x: -20, y: 40 }), { x: -20, y: 40 })
  // Ocupado, al hueco más cercano: un anillo de distancia, no el otro extremo del plano.
  const taken = [{ x: 0, y: 0, footprint }]
  const spot = findFreeCell(footprint, taken, { x: 1, y: 1 })
  assert.equal(collidesWithAny({ ...spot, footprint }, taken), false)
  assert.ok(Math.max(Math.abs(spot.x - 1), Math.abs(spot.y - 1)) <= 2)
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

test('a point of the floor is inside a table from its top-left edge up to, not including, the next cell', () => {
  const table = { x: -2, y: 1, footprint: { w: 3, h: 2 } }

  assert.equal(covers(table, { x: -2, y: 1 }), true)
  assert.equal(covers(table, { x: 0.99, y: 2.99 }), true)
  // El borde de la derecha y el de abajo ya son de la celda vecina.
  assert.equal(covers(table, { x: 1, y: 2 }), false)
  assert.equal(covers(table, { x: 0, y: 3 }), false)
  assert.equal(covers(table, { x: -2.01, y: 1.5 }), false)
})

test('the search goes ring by ring: the top row, both ends of each middle row, then the bottom row', () => {
  const cell = tableFootprint({ width: 1, height: 1 })
  const at = (x: number, y: number) => ({ x, y, footprint: cell })
  const center = { x: 0, y: 0 }

  // Ocupado el lugar pedido, el primer hueco del primer anillo es su esquina de arriba a la izquierda.
  assert.deepEqual(findFreeCell(cell, [at(0, 0)], center), { x: -1, y: -1 })
  // Con el renglón de arriba lleno, sigue por la punta izquierda del renglón del medio…
  const topRow = [at(0, 0), at(-1, -1), at(0, -1), at(1, -1)]
  assert.deepEqual(findFreeCell(cell, topRow, center), { x: -1, y: 0 })
  // …y por la derecha, sin volver a mirar el interior del anillo.
  assert.deepEqual(findFreeCell(cell, [...topRow, at(-1, 0)], center), { x: 1, y: 0 })
  // Lleno el primer anillo, salta al segundo, también desde su esquina de arriba a la izquierda.
  const firstRing = [...topRow, at(-1, 0), at(1, 0), at(-1, 1), at(0, 1), at(1, 1)]
  assert.deepEqual(findFreeCell(cell, firstRing, center), { x: -2, y: -2 })
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

test('the database accepts exactly the shapes the floor editor offers, every size it allows and the same positions', () => {
  const tables = definitionOf('TABLE', 'tables')

  const shapes = tables.match(/CONSTRAINT "tables_shape_valid" CHECK (.*)$/m)
  assert.ok(shapes, 'tables tiene que limitar las formas')
  assert.deepEqual(arrayValues(shapes[1]).sort(), [...tableShapes].sort())

  // El rango de posiciones de la base es el mismo que usa el plano: ni una mesa
  // que el editor deja en un lugar que la base rechaza, ni al revés.
  const positions = tables.match(/CONSTRAINT "tables_position_range" CHECK (.*)$/m)
  assert.ok(positions, 'tables tiene que acotar las posiciones')
  for (const axis of ['position_x', 'position_y']) {
    const range = positions[1].match(new RegExp(`\\("${axis}" >= '?(-?\\d+)'?(?:::integer)?\\) AND \\("${axis}" <= (-?\\d+)\\)`))
    assert.ok(range, `tables tiene que acotar ${axis}`)
    assert.deepEqual([Number(range[1]), Number(range[2])], [FLOOR_BOUNDS.min, FLOOR_BOUNDS.max], axis)
  }

  // El tope de la base no puede quedar por debajo del que ofrece el editor, en ningún eje.
  for (const axis of ['width', 'height']) {
    const range = tables.match(new RegExp(`\\("${axis}" >= (\\d+)\\) AND \\("${axis}" <= (\\d+)\\)`))
    assert.ok(range, `tables tiene que acotar ${axis}`)
    assert.ok(Number(range[1]) <= TABLE_SPAN.min && Number(range[2]) >= TABLE_SPAN.max, axis)
  }
})

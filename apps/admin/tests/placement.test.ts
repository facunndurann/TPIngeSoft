import { test } from 'vitest'
import assert from 'node:assert/strict'
import { changesTo, fitsAt, followPointer } from '../src/features/floor/placement'

const table = (id: string, x: number, y: number, width = 3, height = 3) => ({
  id,
  position_x: x,
  position_y: y,
  width,
  height,
})

/** Un lugar en el plano, en celdas: esquina y tamaño. */
const at = (x: number, y: number, w = 3, h = 3) => ({ x, y, footprint: { w, h } })

test('fitsAt no cuenta a la mesa que se mueve', () => {
  const moving = table('a', 0, 0)
  // Correrla una celda la deja encima de donde estaba: no es un choque.
  assert.equal(fitsAt(moving, at(1, 0), [moving]), true)
})

test('fitsAt choca con la huella entera de las demás, con el tamaño propuesto', () => {
  const moving = table('a', 0, 0, 2, 2)
  const other = table('b', 5, 0)
  assert.equal(fitsAt(moving, at(3, 0, 2, 2), [moving, other]), true) // ocupa 3 y 4: toca, no pisa
  assert.equal(fitsAt(moving, at(4, 0, 2, 2), [moving, other]), false)
  assert.equal(fitsAt(moving, at(7, 2, 2, 2), [moving, other]), false) // la esquina de abajo a la derecha
  // Estirarla sin moverla también puede pisar a la vecina: es la misma regla.
  assert.equal(fitsAt(moving, at(0, 0, 6, 2), [moving, other]), false)
})

test('fitsAt choca en cualquier parte del plano, también lejos o en celdas negativas', () => {
  const moving = table('a', 0, 0)
  // El plano no tiene bordes: una mesa lejos no se dibuja pegada a ningún borde.
  const far = table('b', 40, -12)
  assert.equal(fitsAt(moving, at(21, 0), [moving, far]), true)
  assert.equal(fitsAt(moving, at(39, -13), [moving, far]), false)
  assert.equal(fitsAt(moving, at(43, -12), [moving, far]), true) // pegada a la derecha
})

test('changesTo escribe solo las columnas que cambian, y nada si la mesa queda igual', () => {
  const placed = table('a', 2, 3)
  assert.equal(changesTo(placed, at(2, 3)), null)
  assert.deepEqual(changesTo(placed, at(-1, 3)), { position_x: -1 })
  // Estirarla con Mayús y →: solo el ancho. Mandar la caja entera pisaba el
  // cambio de la tecla anterior, que todavía no se veía.
  assert.deepEqual(changesTo(placed, at(2, 3, 4, 3)), { width: 4 })
  assert.deepEqual(changesTo(placed, at(1, 2, 4, 4)), { position_x: 1, position_y: 2, width: 4, height: 4 })
})

test('moved, a table keeps its size and follows the point where it was grabbed', () => {
  const grip = { kind: 'move' as const, offset: { x: 1.5, y: 0.5 } }
  assert.deepEqual(followPointer(at(2, 2), grip, { x: -3.2, y: 4.6 }), at(-5, 4))
})

test('stretched from a corner, a table keeps the opposite edges still', () => {
  // Desde abajo a la derecha: la esquina de arriba a la izquierda no se mueve.
  const bottomRight = { kind: 'resize' as const, corner: { dx: 1 as const, dy: 1 as const } }
  assert.deepEqual(followPointer(at(2, 2), bottomRight, { x: 7.4, y: 3.2 }), at(2, 2, 5, 1))

  // Desde arriba a la izquierda: los bordes de la derecha (5) y de abajo (5) quedan donde estaban,
  // y la mesa nunca baja de una celda por lado.
  const topLeft = { kind: 'resize' as const, corner: { dx: -1 as const, dy: -1 as const } }
  assert.deepEqual(followPointer(at(2, 2), topLeft, { x: 0.6, y: 4.7 }), at(1, 4, 4, 1))
})

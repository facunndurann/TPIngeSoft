import { test } from 'vitest'
import assert from 'node:assert/strict'
import { overlapsAt } from '../src/features/floor/placement'

const table = (id: string, x: number, y: number, width = 3, height = 3) => ({
  id,
  position_x: x,
  position_y: y,
  width,
  height,
})

test('overlapsAt no cuenta a la mesa que se mueve', () => {
  const moving = table('a', 0, 0)
  // Correrla una celda la deja encima de donde estaba: no es un choque.
  assert.equal(overlapsAt(moving, 1, 0, [moving]), false)
})

test('overlapsAt choca con la huella entera de las demás, con el tamaño de la que se mueve', () => {
  const moving = table('a', 0, 0, 2, 2)
  const other = table('b', 5, 0)
  assert.equal(overlapsAt(moving, 3, 0, [moving, other]), false) // ocupa 3 y 4: toca, no pisa
  assert.equal(overlapsAt(moving, 4, 0, [moving, other]), true)
  assert.equal(overlapsAt(moving, 7, 2, [moving, other]), true) // la esquina de abajo a la derecha
})

test('overlapsAt choca en cualquier parte del plano, también lejos o en celdas negativas', () => {
  const moving = table('a', 0, 0)
  // El plano no tiene bordes: una mesa lejos no se dibuja pegada a ningún borde.
  const far = table('b', 40, -12)
  assert.equal(overlapsAt(moving, 21, 0, [moving, far]), false)
  assert.equal(overlapsAt(moving, 39, -13, [moving, far]), true)
  assert.equal(overlapsAt(moving, 43, -12, [moving, far]), false) // pegada a la derecha
})

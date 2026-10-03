import { test } from 'vitest'
import assert from 'node:assert/strict'
import { chairsAround, seatsPerSide } from '@restaurant-platform/ui'
import { nextTableLabel } from '../src/features/floor/floor'

test('a square table spreads its seats evenly around its four sides', () => {
  assert.deepEqual(seatsPerSide(96, 96, 8), { top: 2, bottom: 2, left: 2, right: 2 })
  assert.deepEqual(seatsPerSide(96, 96, 4), { top: 1, bottom: 1, left: 1, right: 1 })
})

test('a long, narrow table seats people only along its long sides', () => {
  assert.deepEqual(seatsPerSide(180, 80, 6), { top: 3, bottom: 3, left: 0, right: 0 })
  assert.deepEqual(seatsPerSide(40, 220, 3), { top: 0, bottom: 0, left: 2, right: 1 })
})

test('there is one chair per seat, outside the table', () => {
  const box = { left: 100, top: 100, width: 80, height: 80 }
  const centers = (round: boolean) =>
    chairsAround(box, round, 5).map(({ left, top }) => ({ x: left + 6 - 140, y: top + 6 - 140 }))

  const square = centers(false)
  assert.equal(square.length, 5)
  for (const { x, y } of square) assert.ok(Math.max(Math.abs(x), Math.abs(y)) > 40)

  const round = centers(true)
  assert.equal(round.length, 5)
  for (const { x, y } of round) assert.ok(Math.hypot(x, y) > 40)
})

test('a round table starts its chairs at the top', () => {
  const [first] = chairsAround({ left: 0, top: 0, width: 100, height: 100 }, true, 4)
  // Centrada a lo ancho y por encima del borde de arriba.
  assert.equal(Math.round(first.left + 6), 50)
  assert.ok(first.top < 0)
})

test('a new table is named after the highest «Mesa N» in the branch', () => {
  assert.equal(nextTableLabel([]), 'Mesa 1')
  assert.equal(nextTableLabel([{ label: 'Mesa 2' }, { label: 'Mesa 10' }, { label: 'Barra' }]), 'Mesa 11')
  assert.equal(nextTableLabel([{ label: 'Terraza 4' }]), 'Mesa 1')
})

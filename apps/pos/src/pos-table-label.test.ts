import { test } from 'vitest'
import assert from 'node:assert/strict'
import { posTableLabel } from './features/pos/posTableLabel'

/** Una mesa de `cells` celdas de alto, como la dibuja el plano (44 px por celda, 6 de aire). */
const high = (cells: number) => ({ height: cells * 44 - 6 })

test('at full size a table shows its name and state, and with room, its time and a second line for the name', () => {
  assert.deepEqual(posTableLabel(high(1), 1), { size: 12, nameLines: 1, state: true, last: false })
  assert.deepEqual(posTableLabel(high(2), 1), { size: 12, nameLines: 2, state: true, last: true })
})

test('zooming out keeps the text at 12px on screen and hides what no longer fits, last first', () => {
  // A 50 % la letra mide 24 px del plano: una mesa de dos celdas ya no tiene lugar para el tiempo.
  assert.deepEqual(posTableLabel(high(2), 0.5), { size: 24, nameLines: 1, state: true, last: false })
  // Bien de lejos, en una sola celda solo entra el nombre: el estado queda en el color.
  const far = posTableLabel(high(1), 0.3)
  assert.ok(far.size * 0.3 >= 12 - 1e-9)
  assert.deepEqual({ state: far.state, last: far.last }, { state: false, last: false })
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  FLOOR_GRID,
  collidesWithAny,
  occupiedBy,
  resizePlacement,
  tablePlacement,
} from '@restaurant-platform/shared'
import { isStepperChange } from '../src/features/floor/TableInspector'

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

function inputEvent(inputType?: string) {
  const event = new Event('input')
  if (inputType) Object.assign(event, { inputType })
  return event
}

test('isStepperChange reconoce flechas nativas y no cada tecla', () => {
  assert.equal(isStepperChange(inputEvent(), '4', '5'), true)
  assert.equal(isStepperChange(inputEvent('increment'), '4', '5'), true)
  assert.equal(isStepperChange(inputEvent('decrement'), '4', '3'), true)
  assert.equal(isStepperChange(inputEvent('insertReplacementText'), '4', '5'), true)
  assert.equal(isStepperChange(inputEvent('insertText'), '4', '1'), false)
  assert.equal(isStepperChange(inputEvent('insertText'), '1', '12'), false)
  assert.equal(isStepperChange(inputEvent('deleteContentBackward'), '12', '1'), false)
})

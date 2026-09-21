import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resizePlacement } from '@restaurant-platform/shared'
import { isStepperChange } from '../src/features/floor/TableInspector'

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

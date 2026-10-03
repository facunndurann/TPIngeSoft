import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buttonClass, iconButtonClass, type ButtonShape, type ButtonVariant, type ControlSize } from '@restaurant-platform/ui'

const variants: ButtonVariant[] = ['primary', 'secondary', 'danger', 'ghost', 'danger-ghost']
const sizes: ControlSize[] = ['default', 'touch']
const shapes: ButtonShape[] = ['rounded', 'pill']

/** Las clases de borde redondeado: dos no se pisan por orden de escritura, así que tiene que haber una sola. */
const radii = (classes: string) => classes.split(/\s+/).filter((name) => /^rounded(-|$)/.test(name))

test('a button carries exactly one radius, whatever its variant, size or shape', () => {
  for (const variant of variants)
    for (const size of sizes)
      for (const shape of shapes) {
        assert.deepEqual(radii(buttonClass(variant, size, shape)), [shape === 'pill' ? 'rounded-full' : 'rounded-lg'])
        assert.equal(radii(iconButtonClass({ size, shape })).length, 1)
      }
})

test('without a shape, buttons keep the panel’s look: only the Salón asks for pills', () => {
  assert.deepEqual(radii(buttonClass()), ['rounded-lg'])
  assert.deepEqual(radii(iconButtonClass()), ['rounded-lg'])
  // El ícono de siempre va suelto; el secundario se enmarca.
  assert.doesNotMatch(iconButtonClass(), /\bborder\b/)
  assert.match(iconButtonClass({ variant: 'secondary' }), /\bborder\b/)
})

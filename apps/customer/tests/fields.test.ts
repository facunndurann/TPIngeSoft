import { test } from 'vitest'
import assert from 'node:assert/strict'
import { MAX_EQUAL_PARTS, MAX_ITEM_QUANTITY, MIN_EQUAL_PARTS, MIN_ITEM_QUANTITY } from '@restaurant-platform/shared'
import { integerIn } from '../src/hooks/useNumericDraft'

test('the quantity control offers the same range everywhere and cannot step out of it', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { QuantityField } = await import('../src/components/QuantityField')
  const noop = () => {}
  const render = (value: number, disabled = false) =>
    renderToStaticMarkup(createElement(QuantityField, { value, disabled, onChange: noop }))

  const middle = render(5)
  assert.match(middle, new RegExp(`min="${MIN_ITEM_QUANTITY}" max="${MAX_ITEM_QUANTITY}"`))
  assert.match(middle, /value="5"/)
  assert.doesNotMatch(middle, /disabled/)

  // En los extremos del rango el botón que se pasaría queda apagado.
  assert.match(render(MIN_ITEM_QUANTITY), /aria-label="Una unidad menos" disabled/)
  assert.doesNotMatch(render(MIN_ITEM_QUANTITY), /aria-label="Una unidad más" disabled/)
  assert.match(render(MAX_ITEM_QUANTITY), /aria-label="Una unidad más" disabled/)

  // Con el carrito bloqueado no se toca nada del control.
  assert.equal((render(5, true).match(/disabled/g) ?? []).length, 3)
})

test('the percentage field cannot be pushed past what the others left', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { PercentField } = await import('../src/components/PercentField')
  const noop = () => {}
  const render = (value: number | null, max: number) =>
    renderToStaticMarkup(createElement(PercentField, { value, max, label: 'Porcentaje de Ana', onChange: noop }))

  // El techo del campo es lo que queda sin asignar, no el total.
  assert.match(render(40, 60), /max="60"/)
  assert.match(render(40, 60), /value="40"/)
  // Sin asignación el campo va vacío: "no participa del reparto" es un estado válido.
  assert.match(render(null, 100), /value=""/)
  assert.match(render(null, 100), /aria-label="Porcentaje de Ana"/)
})

test('whole-number fields only commit an integer inside their range', () => {
  const parts = integerIn(MIN_EQUAL_PARTS, MAX_EQUAL_PARTS)
  assert.equal(parts(String(MIN_EQUAL_PARTS)), MIN_EQUAL_PARTS)
  assert.equal(parts(String(MAX_EQUAL_PARTS)), MAX_EQUAL_PARTS)
  // Vacío, decimales o fuera de rango quedan como borrador: nada de eso llega a la división.
  for (const typed of ['', '1', '2.5', String(MAX_EQUAL_PARTS + 1), 'abc']) {
    assert.equal(parts(typed), undefined, typed)
  }
})

test('the parts field offers the split range and shows the committed value', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { PartsField } = await import('../src/components/PartsField')
  const html = renderToStaticMarkup(createElement(PartsField, { value: 4, onChange: () => {} }))

  assert.match(html, new RegExp(`min="${MIN_EQUAL_PARTS}" max="${MAX_EQUAL_PARTS}"`))
  assert.match(html, /value="4"/)
  assert.match(html, /Cantidad de personas/)
})

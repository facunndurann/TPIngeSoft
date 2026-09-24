import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  emptyGroupDraft,
  groupDraftErrors,
  groupDraftFrom,
  groupPayload,
  newOptionDraft,
  type ModifierGroupDraft,
} from '../src/features/modifier-group-draft'

const saved = {
  id: 'group-a',
  name: 'Extras',
  min_select: 0,
  max_select: 4,
  is_available: true,
  modifier_options: [
    { id: 'o2', name: 'Panceta', price_delta: 900, is_available: false, sort_order: 2 },
    { id: 'o1', name: 'Cheddar', price_delta: 750.5, is_available: true, sort_order: 1 },
  ],
} as unknown as Parameters<typeof groupDraftFrom>[0]

const valid: ModifierGroupDraft = {
  name: 'Guarnición',
  minSelect: '1',
  maxSelect: '1',
  isAvailable: true,
  options: [{ key: 'k1', name: 'Papas', price: '0', isAvailable: true }],
}

test('groupDraftFrom deja el editor listo, con las opciones en su orden y los números como texto', () => {
  const draft = groupDraftFrom(saved)
  assert.deepEqual([draft.name, draft.minSelect, draft.maxSelect], ['Extras', '0', '4'])
  assert.deepEqual(draft.options.map((option) => option.name), ['Cheddar', 'Panceta'])
  assert.deepEqual(draft.options.map((option) => option.price), ['750.5', '900'])
  // Una opción guardada se identifica por su id, también como fila de la lista.
  assert.deepEqual(draft.options.map((option) => [option.key, option.id]), [['o1', 'o1'], ['o2', 'o2']])
})

test('emptyGroupDraft es un grupo opcional de selección única, sin opciones', () => {
  assert.deepEqual(emptyGroupDraft(), { name: '', minSelect: '0', maxSelect: '1', isAvailable: true, options: [] })
})

test('cada opción nueva tiene su propia fila, aunque no tenga id', () => {
  const [a, b] = [newOptionDraft(), newOptionDraft()]
  assert.notEqual(a.key, b.key)
  assert.equal(a.id, undefined)
  assert.equal(a.price, '0')
})

test('groupDraftErrors nombra el primer problema, y un campo vacío no vale 0', () => {
  assert.equal(groupDraftErrors(valid), null)
  assert.match(groupDraftErrors({ ...valid, name: ' ' })!, /nombre/)
  assert.match(groupDraftErrors({ ...valid, options: [{ ...valid.options[0], name: '' }] })!, /opciones necesitan nombre/)
  assert.match(groupDraftErrors({ ...valid, minSelect: '' })!, /mínimo/)
  assert.match(groupDraftErrors({ ...valid, maxSelect: '0' })!, /máximo/)
  assert.match(groupDraftErrors({ ...valid, minSelect: '1.5' })!, /entero/)
  assert.match(groupDraftErrors({ ...valid, minSelect: '3', maxSelect: '2' })!, /superar/)
  assert.match(groupDraftErrors({ ...valid, options: [] })!, /al menos una opción/)
  for (const price of ['', '-1', 'gratis']) {
    assert.match(groupDraftErrors({ ...valid, options: [{ ...valid.options[0], price }] })!, /precio/)
  }
})

test('groupPayload convierte el borrador y deja afuera la key de cada fila', () => {
  const payload = groupPayload({
    ...valid,
    options: [
      { key: 'o1', id: 'o1', name: 'Papas', price: '0', isAvailable: true },
      { key: 'nueva', name: 'Batatas', price: '350.25', isAvailable: false },
    ],
  })
  assert.deepEqual(payload, {
    name: 'Guarnición',
    minSelect: 1,
    maxSelect: 1,
    isAvailable: true,
    options: [
      { id: 'o1', name: 'Papas', price_delta: 0, is_available: true },
      { id: undefined, name: 'Batatas', price_delta: 350.25, is_available: false },
    ],
  })
  assert.equal(groupPayload({ ...valid, options: [{ ...valid.options[0], price: '' }] }), null)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  emptyGroupDraft,
  groupDraftFrom,
  newOptionDraft,
  parseGroupDraft,
  type ModifierGroupDraft,
} from '../src/features/modifier-group-draft'

/** Los problemas del borrador por campo, o `null` si ya se puede guardar. */
const errorsOf = (draft: ModifierGroupDraft): Record<string, string> | null => {
  const parsed = parseGroupDraft(draft)
  return parsed.ok ? null : Object.fromEntries(parsed.errors.map((error) => [error.field, error.message]))
}

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

test('cada problema queda en su campo, y un campo vacío no vale 0', () => {
  assert.equal(errorsOf(valid), null)
  assert.match(errorsOf({ ...valid, name: ' ' })!.name, /nombre/)
  assert.match(errorsOf({ ...valid, options: [{ ...valid.options[0], name: '' }] })!['option-name-k1'], /nombre de la opción/)
  assert.match(errorsOf({ ...valid, minSelect: '' })!.minSelect, /entero desde 0/)
  assert.match(errorsOf({ ...valid, maxSelect: '0' })!.maxSelect, /entero desde 1/)
  assert.match(errorsOf({ ...valid, minSelect: '1.5' })!.minSelect, /entero/)
  assert.match(errorsOf({ ...valid, minSelect: '3', maxSelect: '2' })!.minSelect, /superar/)
  assert.match(errorsOf({ ...valid, options: [] })!.options, /al menos una opción/)
  for (const price of ['', '-1', 'gratis', '1.234']) {
    assert.match(errorsOf({ ...valid, options: [{ ...valid.options[0], price }] })!['option-price-k1'], /precio/)
  }
})

test('los problemas llegan todos juntos, en el orden del formulario: el foco va al primero', () => {
  const parsed = parseGroupDraft({
    ...valid,
    name: '',
    maxSelect: '0',
    options: [{ key: 'k1', name: '', price: 'gratis', isAvailable: true }],
  })
  assert.equal(parsed.ok, false)
  assert.deepEqual(!parsed.ok && parsed.errors.map((error) => error.field), [
    'name',
    'maxSelect',
    'option-name-k1',
    'option-price-k1',
  ])
})

test('el payload es el borrador convertido, sin la key de cada fila', () => {
  const parsed = parseGroupDraft({
    ...valid,
    options: [
      { key: 'o1', id: 'o1', name: 'Papas', price: '0', isAvailable: true },
      { key: 'nueva', name: 'Batatas', price: '350.25', isAvailable: false },
    ],
  })
  assert.deepEqual(parsed, {
    ok: true,
    payload: {
      name: 'Guarnición',
      minSelect: 1,
      maxSelect: 1,
      isAvailable: true,
      options: [
        { id: 'o1', name: 'Papas', price_delta: 0, is_available: true },
        { id: undefined, name: 'Batatas', price_delta: 350.25, is_available: false },
      ],
    },
  })
  assert.equal(parseGroupDraft({ ...valid, options: [{ ...valid.options[0], price: '' }] }).ok, false)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { draftErrors, draftFrom, draftPrice, emptyDraft } from '../src/features/product-draft'

const saved = {
  id: 'product-a',
  name: 'Hamburguesa',
  description: null,
  category_id: 'category-a',
  base_price: 8900,
  food_info: null,
  dietary_tags: ['picante'],
  is_available: false,
  media_urls: ['https://cdn.test/foto.jpg', 'https://cdn.test/clip.mp4'],
  product_ingredients: [
    { id: 'i2', name: 'Cebolla', is_removable: true, is_available: true, sort_order: 2 },
    { id: 'i1', name: 'Pan', is_removable: false, is_available: true, sort_order: 1 },
  ],
  product_modifier_groups: [{ group_id: 'g1' }, { group_id: 'g2' }],
} as unknown as Parameters<typeof draftFrom>[0]

test('draftFrom deja el formulario listo para montarse, sin pasos intermedios', () => {
  const draft = draftFrom(saved)
  assert.equal(draft.name, 'Hamburguesa')
  // Los nulos de la base son campos vacíos, no `null` en un input.
  assert.equal(draft.description, '')
  assert.equal(draft.foodInfo, '')
  assert.equal(draft.basePrice, '8900')
  assert.equal(draft.isAvailable, false)
  assert.deepEqual(draft.groupIds, ['g1', 'g2'])
  // Los ingredientes respetan sort_order, no el orden en que vinieron.
  assert.deepEqual(draft.ingredients.map((i) => i.name), ['Pan', 'Cebolla'])
  assert.deepEqual(draft.media.map((m) => m.type), ['saved', 'saved'])
})

test('emptyDraft es un producto nuevo disponible y sin nada cargado', () => {
  const draft = emptyDraft()
  assert.equal(draft.isAvailable, true)
  assert.deepEqual([draft.name, draft.categoryId, draft.basePrice], ['', '', ''])
  assert.deepEqual([draft.media, draft.ingredients, draft.groupIds], [[], [], []])
})

test('draftPrice solo acepta un precio real', () => {
  const base = emptyDraft()
  assert.equal(draftPrice({ ...base, basePrice: '0' }), 0)
  assert.equal(draftPrice({ ...base, basePrice: '1250.50' }), 1250.5)
  assert.equal(draftPrice({ ...base, basePrice: '' }), null)
  assert.equal(draftPrice({ ...base, basePrice: '   ' }), null)
  assert.equal(draftPrice({ ...base, basePrice: 'gratis' }), null)
  assert.equal(draftPrice({ ...base, basePrice: '-5' }), null)
})

test('draftErrors dice qué campo impide guardar y por qué', () => {
  const valid = { ...emptyDraft(), name: 'Papas', categoryId: 'c1', basePrice: '500' }
  const only = (draft: typeof valid) => draftErrors(draft).map((error) => error.field)
  assert.deepEqual(draftErrors(valid), [])
  assert.deepEqual(only({ ...valid, name: '  ' }), ['name'])
  assert.deepEqual(only({ ...valid, categoryId: '' }), ['categoryId'])
  assert.deepEqual(only({ ...valid, basePrice: 'x' }), ['basePrice'])
  assert.match(draftErrors({ ...valid, basePrice: '' })[0].message, /precio/)
})

test('draftErrors junta todos los problemas en el orden del formulario', () => {
  const ingredient = (name: string) => ({ name, is_removable: true, is_available: true })
  const errors = draftErrors({
    ...emptyDraft(),
    ingredients: [ingredient('Pan'), ingredient(' '), ingredient('')],
  })
  // Cada ingrediente vacío es su propio campo: el error va debajo de esa fila.
  assert.deepEqual(errors.map((error) => error.field), [
    'name',
    'categoryId',
    'basePrice',
    'ingredient-1',
    'ingredient-2',
  ])
})

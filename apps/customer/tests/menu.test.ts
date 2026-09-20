import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  calculateItemPrice,
  mediaElementSrc,
  mediaKindFromMimeType,
  productMedia,
} from '@restaurant-platform/shared'
import { buildMenu, cartPrice, groupSelectionHint, price, productOptions, selectedInGroup, selectionErrors } from '../src/features/menu'
import type { Menu, MenuRows, ModifierGroup } from '../src/features/menu'
import { menu, product, productAfter, selection } from './fixtures'

test('required single-choice groups and decimal pricing', () => {
  assert.deepEqual(selectionErrors(product, selection), [])
  assert.equal(price(product, selection), 30.90)
  assert.equal(calculateItemPrice(.1, [{ optionId: 'o', priceDelta: .2 }], 3), .9)
  assert.ok(selectionErrors(product, { ...selection, optionIds: [] }).length)
  assert.ok(selectionErrors(product, { ...selection, optionIds: ['o', 'o2'] }).length)
  assert.equal(cartPrice(menu, [{ ...selection, productId: 'p' }, { ...selection, productId: 'p', quantity: 1 }]), 41.2)
})

test('a modifier group says where you are, not just what it allows', () => {
  const group = (min: number, max: number, available = true) => ({
    id: 'g', name: 'Salsa', min_select: min, max_select: max, is_available: available,
    options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  } as unknown as ModifierGroup)

  assert.equal(groupSelectionHint(group(1, 1), []), 'Obligatorio · elegiste 0 de 1 · mínimo 1')
  assert.equal(groupSelectionHint(group(1, 1), ['a']), 'Obligatorio · elegiste 1 de 1')
  assert.equal(groupSelectionHint(group(0, 3), ['a', 'b']), 'Opcional · elegiste 2 de 3')
  assert.equal(groupSelectionHint(group(2, 3), ['a']), 'Obligatorio · elegiste 1 de 3 · mínimo 2')
  // Al llegar al techo se explica por qué el resto quedó deshabilitado.
  assert.equal(groupSelectionHint(group(0, 2), ['a', 'b']), 'Opcional · elegiste 2 de 2 · llegaste al máximo')
  assert.equal(groupSelectionHint(group(1, 2, false), ['a']), 'Obligatorio · elegiste 1 de 2 · Agotado')
  // Solo cuenta lo elegido en este grupo, no en otro del mismo plato.
  assert.equal(groupSelectionHint(group(0, 3), ['z']), 'Opcional · elegiste 0 de 3')
  assert.equal(selectedInGroup(group(0, 3), ['a', 'z']), 1)
})

test('rejects unknown, duplicated and unavailable modifiers', () => {
  for (const optionIds of [['other'], ['o', 'o']]) assert.ok(selectionErrors(product, { ...selection, optionIds }).length)
  assert.ok(selectionErrors(productAfter((changed) => { changed.groups[0].modifier_options[0].is_available = false }), selection).length)
  assert.ok(selectionErrors(productAfter((changed) => { changed.groups[0].is_available = false }), selection).length)
})

test('unavailable ingredients require removal and fixed ingredients cannot be removed', () => {
  const soldOut = productAfter((changed) => { changed.products[0].product_ingredients[0].is_available = false })
  assert.ok(selectionErrors(soldOut, selection).length)
  assert.deepEqual(selectionErrors(soldOut, { ...selection, removedIds: ['i'] }), [])
  const fixed = productAfter((changed) => {
    changed.products[0].product_ingredients[0].is_available = false
    changed.products[0].product_ingredients[0].is_removable = false
  })
  assert.ok(selectionErrors(fixed, { ...selection, removedIds: ['i'] }).length)
  assert.ok(selectionErrors(product, { ...selection, removedIds: ['unknown'] }).length)
})

test('rejects inactive categories, unavailable products and invalid quantities', () => {
  assert.ok(selectionErrors(productAfter((changed) => { changed.categories = [] }), selection).length)
  assert.ok(selectionErrors({ ...product, is_available: false }, selection).length)
  for (const quantity of [0, -1, 1.5, 100, NaN]) assert.ok(selectionErrors(product, { ...selection, quantity }).length)
})

test('buildMenu nests products once: ordered groups shared across products and inactive categories kept for the cart', () => {
  const built: Menu = buildMenu({
    categories: [{ id: 'c' }],
    products: [
      { id: 'a', category_id: 'c', product_ingredients: [{ id: 'i1' }], product_modifier_groups: [{ group_id: 'g2' }, { group_id: 'g1' }] },
      { id: 'b', category_id: 'c', product_ingredients: [], product_modifier_groups: [{ group_id: 'g1' }] },
      { id: 'hidden', category_id: 'inactive', product_ingredients: [], product_modifier_groups: [] },
    ],
    groups: [{ id: 'g1', modifier_options: [{ id: 'o1' }] }, { id: 'g2', modifier_options: [] }],
  } as unknown as MenuRows)
  const [a, b] = built.categories[0].products
  assert.deepEqual(built.categories[0].products.map((entry) => entry.id), ['a', 'b'])
  assert.deepEqual(a.ingredients.map((entry) => entry.id), ['i1'])
  assert.deepEqual(a.groups.map((group) => group.id), ['g2', 'g1'], 'groups keep the assignment order')
  assert.equal(a.groups[1], b.groups[0], 'a group shared by two products is the same object')
  assert.deepEqual(productOptions(a).map((option) => option.id), ['o1'])
  assert.equal('product_modifier_groups' in a, false, 'raw relation fields do not leak into the model')
  assert.equal(built.productsById.get('hidden')?.categoryActive, false)
  assert.equal(built.categories.some((category) => category.products.some((entry) => entry.id === 'hidden')), false)
})

test('productMedia classifies each url and mediaElementSrc only tweaks videos', () => {
  const media = productMedia({
    media_urls: ['https://cdn/a.jpg', 'https://cdn/b.MP4', 'https://cdn/c.webm?v=2'],
  })
  assert.deepEqual(media.map((item) => item.kind), ['image', 'video', 'video'])
  assert.equal(mediaElementSrc(media[0]), 'https://cdn/a.jpg')
  assert.equal(mediaElementSrc(media[1]), 'https://cdn/b.MP4#t=0.001')
  assert.deepEqual(productMedia({ media_urls: [] }), [])
  assert.equal(mediaKindFromMimeType('video/quicktime'), 'video')
  assert.equal(mediaKindFromMimeType('image/png'), 'image')
})

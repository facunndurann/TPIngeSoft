import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  calculateItemPrice,
  mediaElementSrc,
  mediaKindFromMimeType,
  productMedia,
} from '@restaurant-platform/shared'
import { buildMenu, cartPrice, describeSelection, groupRule, price, productOptions, selectedInGroup, selectionErrors, selectionIssues } from '../src/features/menu'
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

test('a modifier group states its rule, not a running count', () => {
  const rule = (min: number, max: number, available = true) =>
    groupRule({ min_select: min, max_select: max, is_available: available })

  assert.equal(rule(1, 1), 'Elegí 1')
  assert.equal(rule(0, 1), 'Opcional')
  assert.equal(rule(0, 3), 'Opcional · hasta 3')
  assert.equal(rule(2, 2), 'Elegí 2')
  assert.equal(rule(2, 3), 'Elegí entre 2 y 3')
  assert.equal(rule(1, 2, false), 'Elegí entre 1 y 2 · Agotado')

  // Solo cuenta lo elegido en este grupo, no en otro del mismo plato.
  const group = { options: [{ id: 'a' }, { id: 'b' }] } as unknown as ModifierGroup
  assert.equal(selectedInGroup(group, ['a', 'z']), 1)
})

test('selection issues sit where the diner fixes them, and the cart reads them as one list', () => {
  const missing = { ...selection, optionIds: [] }
  assert.deepEqual(selectionIssues(product, missing), { product: [], ingredients: [], groups: { g: 'Elegí una opción.' } })
  // Fuera del grupo, el mismo error lleva el nombre del grupo.
  assert.deepEqual(selectionErrors(product, missing), ['Salsa: elegí una opción.'])

  // Lo agotado se dice antes que lo que falta, porque elegir no lo arregla.
  const soldOutGroup = productAfter((changed) => { changed.groups[0].is_available = false })
  assert.deepEqual(selectionIssues(soldOutGroup, missing).groups, { g: 'No está disponible.' })
  const soldOutOption = productAfter((changed) => { changed.groups[0].modifier_options[0].is_available = false })
  assert.deepEqual(selectionIssues(soldOutOption, selection).groups, { g: 'Lo que elegiste se agotó. Elegí otra opción.' })

  const soldOutIngredient = productAfter((changed) => { changed.products[0].product_ingredients[0].is_available = false })
  assert.deepEqual(selectionIssues(soldOutIngredient, selection).ingredients, ['Hay ingredientes agotados. Quitalos si el plato lo permite.'])
  assert.deepEqual(selectionIssues({ ...product, is_available: false }, selection).product, ['Este plato no está disponible.'])
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

test('a selection reads the same in the editable cart line and in its summary', () => {
  const named = productAfter((rows) => {
    rows.products[0].product_ingredients[0].name = 'Cebolla'
    rows.groups[0].modifier_options[0].name = 'Criolla'
  })
  const picked = { optionIds: ['o'], removedIds: ['i'] }

  assert.deepEqual(describeSelection(named, picked), {
    options: [{ id: 'o', name: 'Criolla', priceDelta: 0.2 }],
    removed: [{ id: 'i', name: 'Cebolla' }],
  })

  // Lo que la carta ya no tiene, o todavía no cargó, se nombra igual en las dos vistas y sin precio.
  const pending = { options: [{ id: 'o', name: 'opción por actualizar' }], removed: [{ id: 'i', name: 'ingrediente por actualizar' }] }
  assert.deepEqual(describeSelection(undefined, picked), pending)
  assert.deepEqual(describeSelection(named, { optionIds: ['vieja'], removedIds: ['otro'] }), {
    options: [{ id: 'vieja', name: 'opción por actualizar' }],
    removed: [{ id: 'otro', name: 'ingrediente por actualizar' }],
  })
})

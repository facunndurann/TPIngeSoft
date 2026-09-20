import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildMenu, cartPrice, groupSelectionHint, price, productOptions, selectedInGroup, selectionErrors } from '../src/features/menu'
import type { Menu, MenuRows, ModifierGroup } from '../src/features/menu'
import {
  AppError,
  calculateItemPrice,
  DEFAULT_MENU_DESIGN,
  MAX_ITEM_QUANTITY,
  MENU_DESIGN_IDS,
  MIN_ITEM_QUANTITY,
  mediaElementSrc,
  mediaKindFromMimeType,
  menuDesignCssVarName,
  menuDesignCssVars,
  MENU_DESIGNS,
  productMedia,
  resolveMenuDesign,
} from '@restaurant-platform/shared'
import { cartKeyFor, cartPhase, plateCount } from '../src/features/cart'
import { reorderLines } from '../src/features/reorder'
import type { OrderedLine } from '../src/features/reorder'
import { recoverPendingSession } from '../src/features/session-recovery'
import type { PendingSubmission } from '../src/stores/cart'
import customerCss from '../src/index.css?raw'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } })

// Filas mínimas como las devuelve loadMenu; el modelo se arma con buildMenu, igual que en la app.
const rows = {
  categories: [{ id: 'c' }],
  products: [{
    id: 'p', category_id: 'c', is_available: true, base_price: 10.10,
    product_ingredients: [{ id: 'i', product_id: 'p', is_removable: true, is_available: true }],
    product_modifier_groups: [{ group_id: 'g' }],
  }],
  groups: [{
    id: 'g', name: 'Salsa', min_select: 1, max_select: 1, is_available: true,
    modifier_options: [{ id: 'o', group_id: 'g', price_delta: .20, is_available: true }, { id: 'o2', group_id: 'g', price_delta: 1, is_available: true }],
  }],
} as unknown as MenuRows
const menu = buildMenu(rows)
const product = menu.productsById.get('p')!
/** Producto 'p' tras cambiar una fila, como llegaría en el siguiente refetch de la carta. */
function productAfter(change: (changed: MenuRows) => void) {
  const changed = structuredClone(rows)
  change(changed)
  return buildMenu(changed).productsById.get('p')!
}
const selection = { optionIds: ['o'], removedIds: [], quantity: 3, isShared: false }
test('required single-choice groups and decimal pricing', () => {
  assert.deepEqual(selectionErrors(product, selection), [])
  assert.equal(price(product, selection), 30.90)
  assert.equal(calculateItemPrice(.1, [{ optionId: 'o', priceDelta: .2 }], 3), .9)
  assert.ok(selectionErrors(product, { ...selection, optionIds: [] }).length)
  assert.ok(selectionErrors(product, { ...selection, optionIds: ['o', 'o2'] }).length)
  assert.equal(cartPrice(menu, [{ ...selection, productId: 'p' }, { ...selection, productId: 'p', quantity: 1 }]), 41.2)
})
test('an unconfirmed submission survives reload and retries with the same immutable payload', async () => {
  const { useCart } = await import('../src/stores/cart')
  const key = 'pending-session:user'
  const item = { ...selection, id: 'submitted-line', productId: 'p' }
  useCart.getState().save(key, item)
  const submission = useCart.getState().beginSubmission(key, 'pending-session', 30.9)!
  assert.ok(submission.input.requestId)
  useCart.getState().save(key, { ...item, quantity: 9 })
  useCart.getState().remove(key, item.id)
  assert.equal(useCart.getState().carts[key][0].quantity, 3)
  assert.deepEqual(useCart.getState().beginSubmission(key, 'pending-session', 999), submission)
  const stored = localStorage.getItem('customer-carts')!
  useCart.setState({ carts: {}, submissions: {} })
  localStorage.setItem('customer-carts', stored)
  await useCart.persist.rehydrate()
  assert.deepEqual(useCart.getState().submissions[key], submission)
  useCart.getState().finishSubmission(key, 'stale-response')
  assert.ok(useCart.getState().submissions[key])
  useCart.getState().finishSubmission(key, submission.input.requestId)
  assert.deepEqual(useCart.getState().carts[key], [])
  assert.equal(useCart.getState().submissions[key], undefined)
})
test('a definitive rejection keeps the draft and the next reviewed attempt gets a new key', async () => {
  const { useCart } = await import('../src/stores/cart')
  const key = 'rejected-session:user'
  const item = { ...selection, id: 'rejected-line', productId: 'p' }
  useCart.getState().save(key, item)
  const first = useCart.getState().beginSubmission(key, 'rejected-session', 30.9)!
  useCart.getState().rejectSubmission(key, first.input.requestId)
  assert.deepEqual(useCart.getState().carts[key], [item])
  useCart.getState().save(key, { ...item, quantity: 2 })
  const second = useCart.getState().beginSubmission(key, 'rejected-session', 20.6)!
  assert.notEqual(first.input.requestId, second.input.requestId)
  assert.equal(second.input.items[0].quantity, 2)
  useCart.getState().rejectSubmission(key, first.input.requestId)
  assert.equal(useCart.getState().submissions[key]?.input.requestId, second.input.requestId)
})
test('a successful response removes only the exact submitted snapshots', async () => {
  const { useCart } = await import('../src/stores/cart')
  const key = 'response-session:user'
  const item = { ...selection, id: 'response-line', productId: 'p' }
  const unchanged = { ...item, id: 'unchanged-line' }
  useCart.getState().save(key, item)
  useCart.getState().save(key, unchanged)
  const submission = useCart.getState().beginSubmission(key, 'response-session', 61.8)!
  const changed = { ...item, quantity: 4 }
  const added = { ...item, id: 'later-line' }
  useCart.setState(state => ({ carts: { ...state.carts, [key]: [changed, unchanged, added] } }))
  useCart.getState().finishSubmission(key, submission.input.requestId)
  assert.deepEqual(useCart.getState().carts[key], [changed, added])
})
test('a successful response matches submitted lines by value, not by key or option order', async () => {
  const { useCart } = await import('../src/stores/cart')
  const key = cartKeyFor('ordered-session', 'user')
  const item = { ...selection, optionIds: ['o', 'o2'], removedIds: ['i'], id: 'ordered-line', productId: 'p' }
  useCart.getState().save(key, item)
  const submission = useCart.getState().beginSubmission(key, 'ordered-session', 30.9)!
  const reordered = { productId: 'p', id: 'ordered-line', isShared: false, quantity: 3, removedIds: ['i'], optionIds: ['o2', 'o'] }
  useCart.setState((state) => ({ carts: { ...state.carts, [key]: [reordered] } }))
  useCart.getState().finishSubmission(key, submission.input.requestId)
  assert.deepEqual(useCart.getState().carts[key], [])
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
test('the cart phase is the single source for what the diner can do', () => {
  const item = { ...selection, id: 'line', productId: 'p' }
  const review = { items: [{ ...item }], total: 30.9 }
  const draft = { items: [item], menu, total: 30.9, sessionId: 'session', sessionOpen: true, named: true, reviewing: false, menuOutdated: false, sending: false, cancelling: false }
  assert.deepEqual(cartPhase(draft), { kind: 'editing', editable: true, canReview: true })
  // Sin nombre elegido se puede armar el carrito, pero no enviarlo: la cuenta no
  // sabría de quién es cada plato.
  assert.deepEqual(cartPhase({ ...draft, named: false }), { kind: 'editing', editable: true, canReview: false })
  assert.deepEqual(cartPhase({ ...draft, named: false, reviewing: true, review }), { kind: 'reviewing', review, outdated: false, confirmable: undefined })
  assert.deepEqual(cartPhase({ ...draft, items: [] }), { kind: 'empty' })
  assert.deepEqual(cartPhase({ ...draft, menuOutdated: true }), { kind: 'editing', editable: true, canReview: false })
  assert.deepEqual(cartPhase({ ...draft, items: [{ ...item, optionIds: [] }] }), { kind: 'editing', editable: true, canReview: false })
  assert.deepEqual(cartPhase({ ...draft, sessionOpen: false }), { kind: 'editing', editable: false, canReview: false })
  assert.deepEqual(cartPhase({ ...draft, sending: true }), { kind: 'editing', editable: false, canReview: false }, 'a rejection still refreshing the menu freezes the draft')

  const submission: PendingSubmission = { input: { sessionId: 'session', requestId: 'request', expectedTotal: 30.9, items: [] }, snapshot: [item] }
  assert.deepEqual(cartPhase({ ...draft, submission, sending: true, cancelling: true }), { kind: 'pending', submission, activity: 'sending' })
  assert.deepEqual(cartPhase({ ...draft, submission, cancelling: true }), { kind: 'pending', submission, activity: 'cancelling' })

  const reviewing = { ...draft, reviewing: true, review }
  assert.deepEqual(cartPhase(reviewing), { kind: 'reviewing', review, outdated: false, confirmable: { sessionId: 'session', expectedTotal: 30.9 } })
  assert.deepEqual(cartPhase({ ...reviewing, total: 31 }), { kind: 'reviewing', review, outdated: true, confirmable: undefined })
  assert.deepEqual(cartPhase({ ...reviewing, items: [{ ...item, quantity: 4 }] }), { kind: 'reviewing', review, outdated: true, confirmable: undefined })
  assert.deepEqual(cartPhase({ ...reviewing, menuOutdated: true }), { kind: 'reviewing', review, outdated: false, confirmable: undefined })
  assert.deepEqual(cartPhase({ ...draft, reviewing: true, menu: undefined }), { kind: 'reviewing', review: undefined, outdated: false, confirmable: undefined })
})
test('repeating an order rebuilds only what the current menu still serves', () => {
  const line = (overrides: Partial<OrderedLine> = {}): OrderedLine => ({
    product_id: 'p',
    product_name: 'Milanesa',
    quantity: 2,
    is_shared: true,
    order_item_modifiers: [{ option_id: 'o' }],
    order_item_removed_ingredients: [{ ingredient_id: 'i' }],
    ...overrides,
  })

  const { items, skipped } = reorderLines([line()], menu)
  assert.deepEqual(skipped, [])
  assert.equal(items.length, 1)
  const [repeated] = items
  // Vuelve el mismo plato, con id nuevo para ser una línea propia del carrito.
  assert.equal(repeated.productId, 'p')
  assert.equal(repeated.quantity, 2)
  assert.equal(repeated.isShared, true)
  assert.deepEqual(repeated.optionIds, ['o'])
  assert.deepEqual(repeated.removedIds, ['i'])
  assert.notEqual(repeated.id, reorderLines([line()], menu).items[0].id)
  assert.equal(selectionErrors(product, repeated).length, 0, 'lo repetido tiene que poder enviarse')

  // Lo que el comensal eligió y hoy no está sale con su nombre: el plato sería otro.
  assert.deepEqual(reorderLines([line({ product_id: 'no-existe' })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ product_id: null })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ order_item_modifiers: [{ option_id: 'vieja' }] })], menu).skipped, ['Milanesa'])
  assert.deepEqual(reorderLines([line({ order_item_removed_ingredients: [{ ingredient_id: 'otro' }] })], menu).skipped, ['Milanesa'])
  // El grupo obligatorio sigue siendo obligatorio: sin su opción no se repite.
  assert.deepEqual(reorderLines([line({ order_item_modifiers: [] })], menu).skipped, ['Milanesa'])

  // Una tanda mezclada agrega lo que puede y nombra lo que no.
  const mixed = reorderLines([line(), line({ product_id: 'no-existe', product_name: 'Flan' })], menu)
  assert.equal(mixed.items.length, 1)
  assert.deepEqual(mixed.skipped, ['Flan'])

  // Un ingrediente agotado que se puede quitar se quita solo, como al agregarlo hoy.
  const soldOutIngredient = buildMenu({
    categories: [{ id: 'c' }],
    products: [{
      id: 'p2', category_id: 'c', is_available: true, base_price: 10,
      product_ingredients: [
        { id: 'i1', product_id: 'p2', is_removable: true, is_available: false },
        { id: 'i2', product_id: 'p2', is_removable: true, is_available: true },
      ],
      product_modifier_groups: [],
    }],
    groups: [],
  } as unknown as MenuRows)
  const forced = reorderLines(
    [line({ product_id: 'p2', order_item_modifiers: [], order_item_removed_ingredients: [{ ingredient_id: 'i2' }] })],
    soldOutIngredient,
  )
  assert.deepEqual(forced.items[0].removedIds.slice().sort(), ['i1', 'i2'])

  assert.equal(plateCount(1), '1 plato')
  assert.equal(plateCount(3), '3 platos')
})
test('session recovery restores pending orders after closure only for the authenticated participant and QR table', async () => {
  const previousId = '00000000-0000-4000-8000-000000000001'
  const otherTableId = '00000000-0000-4000-8000-000000000002'
  const otherUserId = '00000000-0000-4000-8000-000000000003'
  const submission = (sessionId: string): PendingSubmission => ({ input: { sessionId, requestId: 'request', expectedTotal: 30.9, items: [{ ...selection, productId: 'p' }] }, snapshot: [] })
  assert.equal(cartKeyFor(previousId, 'me'), `${previousId}:me`, 'the persisted key format must not change')
  const submissions = {
    [`${previousId}:me`]: submission(previousId),
    [`${otherTableId}:me`]: submission(otherTableId),
    [`${otherUserId}:someone-else`]: submission(otherUserId),
    'invalid:me': submission('invalid'),
  }
  const restored = await recoverPendingSession('me', 'qr-table', submissions, async ids => {
    assert.deepEqual(ids, [previousId, otherTableId])
    return [
      { id: otherTableId, table_id: 'other-table', session_participants: [{ user_id: 'me' }] },
      { id: previousId, table_id: 'qr-table', session_participants: [{ user_id: 'me' }], status: 'closed' },
    ]
  })
  assert.equal(restored, previousId)
  assert.equal(await recoverPendingSession('me', 'qr-table', submissions, async () => [
    { id: previousId, table_id: 'qr-table', session_participants: [{ user_id: 'someone-else' }] },
  ]), undefined)
  await assert.rejects(recoverPendingSession('me', 'qr-table', submissions, async () => { throw new Error('offline') }), /offline/)
  assert.equal(await recoverPendingSession('new-user', 'qr-table', submissions, async () => { throw new Error('must not look up another identity') }), undefined)
})
test('customer table URLs encode screens, product pages and menu filters', async () => {
  const paths = await import('../src/features/table-paths')
  assert.equal(paths.tableRoot('demo-burger-mesa-1'), '/m/demo-burger-mesa-1')
  assert.equal(paths.menuSearchParams('all', ''), '')
  assert.equal(paths.menuSearchParams('burgers', ''), '?categoria=burgers')
  assert.equal(paths.menuSearchParams('all', 'pizza'), '?q=pizza')
  assert.equal(paths.menuSearchParams('burgers', 'pizza'), '?categoria=burgers&q=pizza')
  assert.equal(paths.menuPath('demo-burger-mesa-1', 'c1', 'ala'), '/m/demo-burger-mesa-1?categoria=c1&q=ala')
  assert.equal(paths.productPath('t', 'p1', '?categoria=c'), '/m/t/producto/p1?categoria=c')
  assert.equal(paths.cartPath('t'), '/m/t/carrito')
  assert.equal(paths.cartReviewPath('t'), '/m/t/carrito/revisar')
  assert.equal(paths.cartItemPath('t', 'item-1'), '/m/t/carrito/item-1')
  assert.equal(paths.ordersPath('t'), '/m/t/pedidos')
  assert.deepEqual(paths.parseMenuFilters(new URLSearchParams('categoria=c&q=ala')), { category: 'c', search: 'ala' })
  assert.deepEqual(paths.parseMenuFilters(new URLSearchParams()), { category: 'all', search: '' })
  assert.equal(paths.tableSection('/m/x/carrito/revisar'), 'cart')
  assert.equal(paths.tableSection('/m/x/producto/1'), 'menu')
  assert.equal(paths.tableSection('/m/x/pedidos'), 'orders')
  assert.equal(paths.isMenuIndex('/m/x'), true)
  assert.equal(paths.isMenuIndex('/m/x/producto/1'), false)
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
test('cart edits preserve customization and isolate participants and sessions', async () => {
  const { useCart } = await import('../src/stores/cart')
  const item = { ...selection, id: 'line', productId: 'p', removedIds: ['i'], isShared: true }
  useCart.getState().save('session-a:user-a', item)
  useCart.getState().save('session-a:user-b', { ...item, quantity: 1 })
  useCart.getState().save('session-b:user-a', { ...item, quantity: 2 })
  useCart.getState().save('session-a:user-a', { ...item, quantity: 4 })
  assert.equal(useCart.getState().carts['session-a:user-a'].length, 1)
  assert.deepEqual(useCart.getState().carts['session-a:user-a'][0].removedIds, ['i'])
  assert.equal(useCart.getState().carts['session-a:user-b'][0].quantity, 1)
  assert.equal(useCart.getState().carts['session-b:user-a'][0].quantity, 2)
  const saved = memory.get('customer-carts')!
  useCart.setState({ carts: {} })
  memory.set('customer-carts', saved)
  useCart.persist.rehydrate()
  assert.equal(useCart.getState().carts['session-a:user-a'][0].quantity, 4)
  assert.equal(useCart.getState().carts['session-a:user-a'][0].isShared, true)
  useCart.getState().remove('session-a:user-a', 'line')
  assert.deepEqual(useCart.getState().carts['session-a:user-a'], [])
})

test('resolveMenuDesign returns catalog entries and falls back to oliva', () => {
  assert.equal(resolveMenuDesign('oliva').id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign('oliva').layout, 'classic')
  assert.equal(resolveMenuDesign('brasas').layout, 'kiosk')
  assert.equal(resolveMenuDesign('linterna').layout, 'editorial')
  assert.equal(resolveMenuDesign('unknown').id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign(null).id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign(undefined).id, DEFAULT_MENU_DESIGN)
  assert.deepEqual(MENU_DESIGN_IDS, ['oliva', 'brasas', 'linterna'])
  for (const id of MENU_DESIGN_IDS) assert.equal(MENU_DESIGNS[id].id, id)
  assert.equal(menuDesignCssVars(resolveMenuDesign('brasas').tokens)['--menu-accent'], resolveMenuDesign('brasas').tokens.accent)
})

test('design tokens define exactly the CSS variables the customer stylesheet uses', () => {
  assert.equal(menuDesignCssVarName('bg'), '--menu-bg')
  assert.equal(menuDesignCssVarName('surfaceMuted'), '--menu-surface-muted')
  assert.equal(menuDesignCssVarName('radiusPill'), '--menu-radius-pill')

  // index.css ya no declara valores por defecto: una variable sin token dejaría un estilo roto.
  const used = [...new Set(customerCss.match(/--menu-[a-z-]+/g))].sort()
  for (const id of MENU_DESIGN_IDS) {
    assert.deepEqual(Object.keys(menuDesignCssVars(MENU_DESIGNS[id].tokens)).sort(), used, `Tokens of ${id}`)
  }
})

test('MenuShell paints catalog tokens, layout and copy for each design', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MenuShell } = await import('../src/features/MenuShell')
  const { MenuDesignContext } = await import('../src/features/menu-design')
  const { TableHeader } = await import('../src/features/TableHeader')

  for (const id of ['oliva', 'brasas', 'linterna'] as const) {
    const design = resolveMenuDesign(id)
    // TableHeader no recibe el texto por props: tiene que leerlo del contexto.
    const html = renderToStaticMarkup(
      createElement(
        MenuDesignContext,
        { value: design },
        createElement(
          MenuShell,
          null,
          createElement(TableHeader, {
            restaurantName: 'Demo',
            branchName: 'Casa',
            tableLabel: 'Mesa 1',
          }),
        ),
      ),
    )
    assert.match(html, new RegExp(`data-design="${id}"`))
    assert.match(html, new RegExp(`data-layout="${design.layout}"`))
    assert.match(html, new RegExp(design.tokens.bg.replace('#', '[#]')))
    assert.match(html, new RegExp(design.copy.welcome))
  }
})

test('an error only offers to retry when repeating can work', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ErrorMessage } = await import('../src/components/ErrorMessage')
  const noop = () => {}
  const render = (error: unknown, recover?: { label: string; onAction: () => void }) =>
    renderToStaticMarkup(createElement(ErrorMessage, { error, retry: noop, recover }))

  // Red caída y errores sin código se asumen reintentables.
  assert.match(render(new AppError('CONNECTION_ERROR')), /Reintentar<\/button>/)
  assert.match(render(new Error('Algo raro pasó')), /Algo raro pasó[\s\S]*Reintentar/)
  assert.match(render('ni un Error'), /No pudimos conectar/)

  // Un rechazo definitivo no invita a chocar de nuevo: ofrece otra salida.
  const dead = new AppError('TABLE_UNAVAILABLE')
  assert.doesNotMatch(render(dead), /Reintentar/)
  assert.match(render(dead), /Recargar la página<\/button>/)
  assert.match(render(dead, { label: 'Ir al inicio', onAction: noop }), /Ir al inicio<\/button>/)
  // La salida propia es solo para lo definitivo: lo reintentable se sigue reintentando.
  assert.match(render(new AppError('CONNECTION_ERROR'), { label: 'Ir al inicio', onAction: noop }), /Reintentar<\/button>/)

  assert.match(render(dead), /role="alert"/)
})
test('the table header welcomes on the menu and is only context elsewhere', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { TableHeader } = await import('../src/features/TableHeader')
  const props = { restaurantName: 'La Parrilla', branchName: 'Centro', tableLabel: 'Mesa 4' }

  const welcome = renderToStaticMarkup(createElement(TableHeader, props))
  assert.match(welcome, /class="eyebrow"/)
  assert.match(welcome, /<h1>La Parrilla<\/h1>/)

  // Compacto: una línea con el mismo dato, sin eyebrow ni párrafo aparte, y un solo h1.
  const compact = renderToStaticMarkup(createElement(TableHeader, { ...props, compact: true }))
  assert.doesNotMatch(compact, /class="eyebrow"/)
  assert.match(compact, /<header class="compact"><h1>La Parrilla/)
  assert.match(compact, /Centro/)
  assert.match(compact, /Mesa 4/)
  assert.equal((compact.match(/<h1/g) ?? []).length, 1)
  assert.ok(compact.length < welcome.length)
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

test('Toast keeps its live region mounted and schedules the fade within its own duration', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { Toast } = await import('../src/components/Toast')
  const { toastDuration } = await import('../src/features/announcements')
  const noop = () => {}
  const timingOf = (html: string) =>
    [/animation-duration:(\d+)ms/, /animation-delay:0ms, (\d+)ms/].map((pattern) => Number(html.match(pattern)?.[1]))

  assert.equal(renderToStaticMarkup(createElement(Toast, { onDismiss: noop })), '<div class="toast-container" role="status"></div>')

  const plain = renderToStaticMarkup(createElement(Toast, { announcement: { id: 1, message: 'Pedido enviado' }, onDismiss: noop }))
  assert.match(plain, /role="status"><div class="toast"/)
  assert.doesNotMatch(plain, /Deshacer/)
  const [duration, delay] = timingOf(plain)
  // El dueño limpia el mensaje justo cuando termina la salida animada.
  assert.equal(delay + duration, toastDuration(false))

  // Un aviso con deshacer dura más: el botón tiene que ser alcanzable.
  const undoable = renderToStaticMarkup(createElement(Toast, { announcement: { id: 2, message: 'Se quitó', undo: noop }, onDismiss: noop }))
  assert.match(undoable, /class="toast-undo"[^>]*>Deshacer</)
  const [undoDuration, undoDelay] = timingOf(undoable)
  assert.equal(undoDelay + undoDuration, toastDuration(true))
  assert.ok(toastDuration(true) > toastDuration(false))
})

test('the cart puts an undone plate back in its place and starting over drops the draft', async () => {
  const { useCart } = await import('../src/stores/cart')
  const key = 'undo-session:diner'
  const plate = (id: string) => ({ id, productId: 'p', quantity: 1, optionIds: [], removedIds: [], isShared: false })

  useCart.setState({ carts: { [key]: [plate('a'), plate('b'), plate('c')] }, submissions: {} })
  useCart.getState().remove(key, 'b')
  useCart.getState().restore(key, plate('b'), 1)
  assert.deepEqual(useCart.getState().carts[key].map((item) => item.id), ['a', 'b', 'c'])

  // Deshacer dos veces no puede duplicar el plato.
  useCart.getState().restore(key, plate('b'), 1)
  assert.equal(useCart.getState().carts[key].length, 3)

  // Un carrito más corto que cuando se quitó recibe el plato al final.
  useCart.getState().remove(key, 'a')
  useCart.getState().remove(key, 'c')
  useCart.getState().restore(key, plate('c'), 2)
  assert.deepEqual(useCart.getState().carts[key].map((item) => item.id), ['b', 'c'])

  useCart.getState().clear(key)
  assert.equal(useCart.getState().carts[key], undefined)

  // Con un envío sin resolver el carrito está bloqueado: nada lo toca.
  useCart.setState({ carts: { [key]: [plate('a')] }, submissions: { [key]: { input: { sessionId: 's', requestId: 'r', expectedTotal: 1, items: [] }, snapshot: [] } } as unknown as Record<string, PendingSubmission> })
  useCart.getState().clear(key)
  useCart.getState().restore(key, plate('z'), 0)
  assert.deepEqual(useCart.getState().carts[key].map((item) => item.id), ['a'])
  useCart.setState({ carts: {}, submissions: {} })
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

test('the remembered table survives only as three usable strings', async () => {
  const { lastTable, rememberTable } = await import('../src/features/last-table')

  assert.equal(lastTable(), undefined)
  rememberTable({ token: 'qr-1', tableLabel: 'Mesa 4', restaurantName: 'La Parrilla' })
  assert.deepEqual(lastTable(), { token: 'qr-1', tableLabel: 'Mesa 4', restaurantName: 'La Parrilla' })

  // Un valor viejo, incompleto o roto no puede ofrecer un enlace a medias.
  for (const stored of ['{"token":"qr-1"}', '{"token":"","tableLabel":"Mesa 4","restaurantName":"R"}', 'no-json', 'null']) {
    globalThis.localStorage.setItem('customer-last-table', stored)
    assert.equal(lastTable(), undefined)
  }
  globalThis.localStorage.removeItem('customer-last-table')
})

test('product cards keep the link and the carousel controls as siblings', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router')
  const { MenuBrowse } = await import('../src/features/MenuBrowse')

  const card = (overrides: object) => ({
    id: 'x', category_id: 'c', name: 'Plato', description: null, base_price: 10,
    dietary_tags: [], is_available: true, media_urls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
    product_ingredients: [], product_modifier_groups: [], ...overrides,
  })
  const render = (canEdit: boolean, products: object[]) => renderToStaticMarkup(createElement(
    MemoryRouter, null,
    createElement(MenuBrowse, {
      token: 't',
      canEdit,
      menu: buildMenu({ categories: [{ id: 'c', name: 'Platos' }], products, groups: [] } as unknown as MenuRows),
    }),
  ))

  const html = render(true, [card({ id: 'many' }), card({ id: 'sold-out', is_available: false })])
  const cards = html.match(/<article class="product-card[^"]*">[\s\S]*?<\/article>/g) ?? []
  assert.equal(cards.length, 2)

  const [available, soldOut] = cards
  assert.match(available, /<a class="product-card-link" href="\/m\/t\/producto\/many"[^>]*>Plato<\/a>/)
  // Las flechas nombran lo que van a mostrar y los puntos llevan a cada medio.
  assert.match(available, /aria-label="Ver foto siguiente"/)
  assert.match(available, /aria-label="Ver foto anterior"/)
  assert.match(available, /<button type="button" class="dot active"[^>]*aria-pressed="true"/)
  assert.match(available, /aria-label="Ver foto 2 de 2"[^>]*aria-pressed="false"/)
  assert.match(soldOut, /class="product-card is-disabled"/)
  assert.doesNotMatch(soldOut, /<a /, 'Unavailable dishes are not links')
  // Ningún control interactivo anidado dentro de otro.
  assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<button/)
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<(?:button|a) /)

  // Cada categoría es una sección de la carta y cada plato una de su categoría: los
  // niveles bajan de a uno y el h1 de la pantalla es del restaurante, no de la carta.
  assert.doesNotMatch(html, /<h1/)
  assert.match(html, /<h2>[^<]*<\/h2>[\s\S]*<h3 class="section-title">Platos<\/h3>/)
  assert.match(html, /<h4><a class="product-card-link"/)
  // Un solo valor de aria-current en toda la app, el del estándar.
  assert.match(html, /aria-current="page"[^>]*>Todo</)
  assert.doesNotMatch(html, /aria-current="true"/)
})

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

test('design preview renders the real menu with each layout, offline and non-interactive', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { DesignPreviewPage } = await import('../src/pages/DesignPreviewPage')

  const render = (path: string) => renderToStaticMarkup(createElement(
    MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null, createElement(Route, { path: '/vista-previa/:designId', element: createElement(DesignPreviewPage) })),
  ))

  for (const design of Object.values(MENU_DESIGNS)) {
    const html = render(`/vista-previa/${design.id}`)
    assert.match(html, new RegExp(`data-layout="${design.layout}"`))
    assert.match(html, new RegExp(design.copy.menuTitle.replace('?', '\\?')))
    assert.equal((html.match(/<article class="product-card"/g) ?? []).length, 4)
  }
  const fallback = render('/vista-previa/no-existe')
  assert.match(fallback, new RegExp(`data-design="${DEFAULT_MENU_DESIGN}"`))
  assert.match(fallback, /^<div inert="">/, 'The preview is for looking only')
  assert.doesNotMatch(fallback, /src="https?:/, 'Sample photos are embedded, not fetched')
})

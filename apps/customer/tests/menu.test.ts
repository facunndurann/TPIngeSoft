import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartPrice, price, selectionErrors } from '../src/features/menu'
import {
  calculateItemPrice,
  DEFAULT_MENU_DESIGN,
  mediaElementSrc,
  mediaKindFromMimeType,
  menuDesignCssVars,
  MENU_DESIGNS,
  productMedia,
  resolveMenuDesign,
} from '@restaurant-platform/shared'
import { recoverPendingSession } from '../src/features/session-recovery'
import type { PendingSubmission } from '../src/stores/cart'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } })

const product = { id: 'p', category_id: 'c', is_available: true, base_price: 10.10 }
const menu = {
  categories: [{ id: 'c' }], products: [product],
  ingredients: [{ id: 'i', product_id: 'p', is_removable: true, is_available: true }],
  links: [{ product_id: 'p', group_id: 'g' }],
  groups: [{ id: 'g', name: 'Salsa', min_select: 1, max_select: 1, is_available: true }],
  options: [{ id: 'o', group_id: 'g', price_delta: .20, is_available: true }, { id: 'o2', group_id: 'g', price_delta: 1, is_available: true }],
}
const selection = { optionIds: ['o'], removedIds: [], quantity: 3, isShared: false }
test('required single-choice groups and decimal pricing', () => {
  assert.deepEqual(selectionErrors(menu, product, selection), [])
  assert.equal(price(menu, product, selection), 30.90)
  assert.equal(calculateItemPrice(.1, [{ optionId: 'o', priceDelta: .2 }], 3), .9)
  assert.ok(selectionErrors(menu, product, { ...selection, optionIds: [] }).length)
  assert.ok(selectionErrors(menu, product, { ...selection, optionIds: ['o', 'o2'] }).length)
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
test('session recovery restores pending orders after closure only for the authenticated participant and QR table', async () => {
  const previousId = '00000000-0000-4000-8000-000000000001'
  const otherTableId = '00000000-0000-4000-8000-000000000002'
  const otherUserId = '00000000-0000-4000-8000-000000000003'
  const submission = (sessionId: string): PendingSubmission => ({ input: { sessionId, requestId: 'request', expectedTotal: 30.9, items: [{ ...selection, productId: 'p' }] }, snapshot: [] })
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
  for (const optionIds of [['other'], ['o', 'o']]) assert.ok(selectionErrors(menu, product, { ...selection, optionIds }).length)
  const changed = structuredClone(menu)
  changed.options[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
  changed.groups[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
})
test('unavailable ingredients require removal and fixed ingredients cannot be removed', () => {
  const changed = structuredClone(menu)
  changed.ingredients[0].is_available = false
  assert.ok(selectionErrors(changed, product, selection).length)
  assert.deepEqual(selectionErrors(changed, product, { ...selection, removedIds: ['i'] }), [])
  changed.ingredients[0].is_removable = false
  assert.ok(selectionErrors(changed, product, { ...selection, removedIds: ['i'] }).length)
  assert.ok(selectionErrors(menu, product, { ...selection, removedIds: ['unknown'] }).length)
})
test('rejects inactive categories, unavailable products and invalid quantities', () => {
  assert.ok(selectionErrors({ ...menu, categories: [] }, product, selection).length)
  assert.ok(selectionErrors(menu, { ...product, is_available: false }, selection).length)
  for (const quantity of [0, -1, 1.5, 100, NaN]) assert.ok(selectionErrors(menu, product, { ...selection, quantity }).length)
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
  assert.equal(MENU_DESIGNS.length, 3)
  assert.equal(menuDesignCssVars(resolveMenuDesign('brasas').tokens)['--menu-accent'], resolveMenuDesign('brasas').tokens.accent)
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

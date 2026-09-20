import { test } from 'vitest'
import assert from 'node:assert/strict'
import { cartKeyFor, cartPhase } from '../src/features/cart'
import { recoverPendingSession } from '../src/features/session-recovery'
import { useCart } from '../src/stores/cart'
import type { PendingSubmission } from '../src/stores/cart'
import { menu, selection } from './fixtures'

test('an unconfirmed submission survives reload and retries with the same immutable payload', async () => {
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

test('a definitive rejection keeps the draft and the next reviewed attempt gets a new key', () => {
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

test('a successful response removes only the exact submitted snapshots', () => {
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

test('a successful response matches submitted lines by value, not by key or option order', () => {
  const key = cartKeyFor('ordered-session', 'user')
  const item = { ...selection, optionIds: ['o', 'o2'], removedIds: ['i'], id: 'ordered-line', productId: 'p' }
  useCart.getState().save(key, item)
  const submission = useCart.getState().beginSubmission(key, 'ordered-session', 30.9)!
  const reordered = { productId: 'p', id: 'ordered-line', isShared: false, quantity: 3, removedIds: ['i'], optionIds: ['o2', 'o'] }
  useCart.setState((state) => ({ carts: { ...state.carts, [key]: [reordered] } }))
  useCart.getState().finishSubmission(key, submission.input.requestId)
  assert.deepEqual(useCart.getState().carts[key], [])
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

test('cart edits preserve customization and isolate participants and sessions', () => {
  const item = { ...selection, id: 'line', productId: 'p', removedIds: ['i'], isShared: true }
  useCart.getState().save('session-a:user-a', item)
  useCart.getState().save('session-a:user-b', { ...item, quantity: 1 })
  useCart.getState().save('session-b:user-a', { ...item, quantity: 2 })
  useCart.getState().save('session-a:user-a', { ...item, quantity: 4 })
  assert.equal(useCart.getState().carts['session-a:user-a'].length, 1)
  assert.deepEqual(useCart.getState().carts['session-a:user-a'][0].removedIds, ['i'])
  assert.equal(useCart.getState().carts['session-a:user-b'][0].quantity, 1)
  assert.equal(useCart.getState().carts['session-b:user-a'][0].quantity, 2)
  const saved = localStorage.getItem('customer-carts')!
  useCart.setState({ carts: {} })
  localStorage.setItem('customer-carts', saved)
  useCart.persist.rehydrate()
  assert.equal(useCart.getState().carts['session-a:user-a'][0].quantity, 4)
  assert.equal(useCart.getState().carts['session-a:user-a'][0].isShared, true)
  useCart.getState().remove('session-a:user-a', 'line')
  assert.deepEqual(useCart.getState().carts['session-a:user-a'], [])
})

test('the cart puts an undone plate back in its place and starting over drops the draft', () => {
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

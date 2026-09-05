// Run against the seeded local stack with submit-order being served:
//   pnpm supabase functions serve submit-order
//   node supabase/tests/orders.integration.mjs
// Optional: SUPABASE_SERVICE_ROLE_KEY also removes the three anonymous test users.
// Fixtures are isolated and removed in finally; existing menus/orders are untouched.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../apps/customer/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const envFile = await readFile(new URL('../../apps/customer/.env', import.meta.url), 'utf8').catch(() => '')
const fileEnv = Object.fromEntries(envFile.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const apiUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? fileEnv.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? fileEnv.VITE_SUPABASE_ANON_KEY
assert.ok(apiUrl && anonKey, 'Configure apps/customer/.env or SUPABASE_URL and SUPABASE_ANON_KEY.')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname),
  'This integration suite only runs against local Supabase; it uses the demo seed accounts.')

const clients = []
const anonymousIds = []
const fixtures = []
let passed = 0
let failure
const runId = randomUUID()
const title = `Integration ${runId}`

function client(key = anonKey) {
  const result = createClient(apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    }) },
  })
  clients.push(result)
  return result
}

function unwrap({ data, error }, action) {
  if (error) throw new Error(`${action}: ${error.code ?? error.name ?? 'API_ERROR'}: ${error.message}`)
  return data
}

async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

async function login(email) {
  const result = client()
  unwrap(await result.auth.signInWithPassword({ email, password: 'demo1234' }), 'Demo admin login')
  return result
}

async function anonymous() {
  const result = client()
  const session = unwrap(await result.auth.signInAnonymously(), 'Anonymous login')
  assert.ok(session.user?.is_anonymous)
  anonymousIds.push(session.user.id)
  return result
}

async function createFixture(admin, table, values) {
  const row = unwrap(await admin.from(table).insert(values).select().single(), `Create ${table} fixture`)
  fixtures.push({ admin, table, id: row.id })
  return row
}

async function rows(actor, table, column, id, select = '*') {
  return unwrap(await actor.from(table).select(select).eq(column, id), `Read ${table}`)
}

async function update(actor, table, id, values) {
  return unwrap(await actor.from(table).update(values).eq('id', id).select().single(), `Update ${table}`)
}

async function edge(actor, body) {
  const session = actor ? unwrap(await actor.auth.getSession(), 'Get caller session').session : null
  const response = await fetch(`${apiUrl}/functions/v1/submit-order`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const bodyText = await response.text()
  let data
  try { data = JSON.parse(bodyText) } catch {
    throw new Error(`submit-order returned HTTP ${response.status} without JSON. Start pnpm supabase functions serve submit-order.`)
  }
  return { ok: response.ok, status: response.status, data }
}

function successful(result) {
  assert.ok(result.ok, `submit-order HTTP ${result.status}: ${JSON.stringify(result.data)}`)
  assert.match(result.data.orderId, /^[0-9a-f-]{36}$/i)
  assert.equal(result.data.status, 'accepted')
  return result.data
}

function rejected(result, statuses = [400, 403, 409, 422], code) {
  assert.ok(!result.ok && statuses.includes(result.status), `Expected rejection, got HTTP ${result.status}: ${JSON.stringify(result.data)}`)
  assert.equal(typeof result.data.error?.code, 'string', 'Edge error has a machine-readable code')
  assert.equal(typeof result.data.error?.message, 'string', 'Edge error has a readable message')
  if (code) assert.equal(result.data.error.code, code)
}

async function assertBill(actor, sessionId, expected) {
  const records = await rows(actor, 'session_bills', 'session_id', sessionId)
  assert.equal(records.length, 1)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(typeof value === 'number' ? Number(records[0][key]) : records[0][key], value, `Bill ${key}`)
  }
}

async function subscribe(actor, sessionId) {
  const events = []
  const channel = actor.channel(`integration-orders-${randomUUID()}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'orders', filter: `session_id=eq.${sessionId}`,
  }, (event) => events.push(event))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 12_000)
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`Realtime ${status}: ${error?.message ?? 'check local Realtime service'}`))
      }
    })
  })
  return events
}

async function waitForEvent(events, predicate) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (events.some(predicate)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail('Expected Realtime order event within 10 seconds')
}

try {
  const [admin, otherAdmin] = await Promise.all([login('admin@esquina.demo'), login('admin@nonna.demo')])
  const restaurants = unwrap(await admin.from('restaurants').select('id,slug'), 'Read seed restaurants')
  const restaurantId = restaurants.find((row) => row.slug === 'esquina-burger')?.id
  const otherRestaurantId = restaurants.find((row) => row.slug === 'trattoria-nonna')?.id
  assert.ok(restaurantId && otherRestaurantId, 'Both demo restaurants must exist; apply the local seed first.')
  const branch = (await rows(admin, 'branches', 'restaurant_id', restaurantId)).find((row) => row.is_active)
  const otherBranch = (await rows(otherAdmin, 'branches', 'restaurant_id', otherRestaurantId)).find((row) => row.is_active)
  assert.ok(branch && otherBranch, 'Each demo restaurant needs an active branch.')

  // Every mutable record belongs to this run and is registered immediately for cleanup.
  const table = await createFixture(admin, 'tables', { restaurant_id: restaurantId, branch_id: branch.id, label: title, qr_token: `integration-${runId}` })
  const otherTable = await createFixture(otherAdmin, 'tables', { restaurant_id: otherRestaurantId, branch_id: otherBranch.id, label: title, qr_token: `integration-other-${runId}` })
  const category = await createFixture(admin, 'menu_categories', { restaurant_id: restaurantId, name: title })
  const otherCategory = await createFixture(otherAdmin, 'menu_categories', { restaurant_id: otherRestaurantId, name: title })
  const product = await createFixture(admin, 'products', { restaurant_id: restaurantId, category_id: category.id, name: `${title} configurable`, base_price: 1250.25 })
  const simple = await createFixture(admin, 'products', { restaurant_id: restaurantId, category_id: category.id, name: `${title} simple`, base_price: 1000 })
  const foreign = await createFixture(otherAdmin, 'products', { restaurant_id: otherRestaurantId, category_id: otherCategory.id, name: `${title} foreign`, base_price: 1000 })
  const group = await createFixture(admin, 'modifier_groups', { restaurant_id: restaurantId, name: `${title} required`, min_select: 1, max_select: 1 })
  await createFixture(admin, 'product_modifier_groups', { restaurant_id: restaurantId, product_id: product.id, group_id: group.id })
  const option = await createFixture(admin, 'modifier_options', { restaurant_id: restaurantId, group_id: group.id, name: `${title} option`, price_delta: 149.75 })
  const extraOption = await createFixture(admin, 'modifier_options', { restaurant_id: restaurantId, group_id: group.id, name: `${title} second option`, price_delta: 0 })
  const removable = await createFixture(admin, 'product_ingredients', { restaurant_id: restaurantId, product_id: product.id, name: `${title} removable`, is_removable: true })
  const fixed = await createFixture(admin, 'product_ingredients', { restaurant_id: restaurantId, product_id: product.id, name: `${title} fixed`, is_removable: false })

  const [customer, peer, outsider] = await Promise.all([anonymous(), anonymous(), anonymous()])
  let sessionId
  let otherSessionId
  await check('two anonymous participants concurrently join the same QR session', async () => {
    const sessions = await Promise.all([customer, peer].map(async (actor, index) => unwrap(
      await actor.rpc('join_table_session', { qr: table.qr_token, participant_name: `Test diner ${index + 1}` }), 'Join shared QR',
    )))
    assert.equal(sessions[0], sessions[1])
    sessionId = sessions[0]
    otherSessionId = unwrap(await outsider.rpc('join_table_session', { qr: otherTable.qr_token, participant_name: 'Other restaurant' }), 'Join other restaurant')
    assert.notEqual(otherSessionId, sessionId)
    assert.equal((await rows(customer, 'session_participants', 'session_id', sessionId)).length, 2)
  })

  const request = (overrides = {}) => ({
    sessionId,
    requestId: randomUUID(),
    items: [{ productId: product.id, quantity: 2, optionIds: [option.id], removedIds: [removable.id], isShared: true }],
    expectedTotal: 2800,
    notes: 'Preparar juntos',
    ...overrides,
  })
  const itemRequest = (overrides) => request({ items: [{ ...request().items[0], ...overrides }] })
  const basicRequest = () => request({ items: [{ productId: simple.id, quantity: 1, optionIds: [], removedIds: [], isShared: false }], expectedTotal: 1000 })

  await check('a fresh session has no consumption or payments', () => assertBill(customer, sessionId, {
    submitted_amount: 0, total_amount: 0, paid_amount: 0, pending_amount: 0,
  }))
  await check('Edge requires an authenticated diner', async () => {
    const result = await edge(null, request())
    assert.equal(result.status, 401)
  })
  await check('a participant cannot submit into another restaurant session', async () => rejected(await edge(outsider, request())))
  await check('products from another restaurant are rejected', async () => rejected(await edge(customer, itemRequest({ productId: foreign.id, optionIds: [], removedIds: [] }))))
  await check('server rejects a forged or outdated price', async () => rejected(await edge(customer, request({ expectedTotal: 1 })), [409], 'PRICE_CHANGED'))
  await check('required modifier selections are enforced', async () => rejected(await edge(customer, itemRequest({ optionIds: [] }))))
  await check('modifier maximum and duplicate selections are enforced', async () => {
    rejected(await edge(customer, itemRequest({ optionIds: [option.id, extraOption.id] })))
    rejected(await edge(customer, itemRequest({ optionIds: [option.id, option.id] })))
  })
  await check('unknown and unlinked modifier options are rejected', async () => {
    rejected(await edge(customer, itemRequest({ optionIds: [randomUUID()] })))
    rejected(await edge(customer, itemRequest({ productId: simple.id, removedIds: [] })))
  })
  await check('non-removable and unknown ingredients are rejected', async () => {
    rejected(await edge(customer, itemRequest({ removedIds: [fixed.id] })))
    rejected(await edge(customer, itemRequest({ removedIds: [randomUUID()] })))
  })
  await check('quantities must be positive integers', async () => {
    rejected(await edge(customer, itemRequest({ quantity: 0 })))
    rejected(await edge(customer, itemRequest({ quantity: 1.5 })))
  })
  await check('unavailable products and options cannot be ordered', async () => {
    await update(admin, 'products', product.id, { is_available: false })
    try { rejected(await edge(customer, request())) } finally {
      await update(admin, 'products', product.id, { is_available: true })
    }
    await update(admin, 'modifier_options', option.id, { is_available: false })
    try { rejected(await edge(customer, request())) } finally {
      await update(admin, 'modifier_options', option.id, { is_available: true })
    }
  })
  await check('invalid requests leave no partial orders', async () => {
    assert.equal((await rows(admin, 'orders', 'session_id', sessionId)).length, 0)
  })

  const peerEvents = await subscribe(peer, sessionId)
  const outsiderEvents = await subscribe(outsider, sessionId)
  const originalRequest = request()
  let orderId
  await check('concurrent retries create and dispatch exactly one order', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => edge(customer, originalRequest)))
    const orders = results.map(successful)
    orderId = orders[0].orderId
    assert.ok(orders.every((order) => order.orderId === orderId && Number(order.totalAmount) === 2800))
    assert.equal((await rows(customer, 'orders', 'session_id', sessionId)).length, 1)
    const logs = await rows(admin, 'integration_logs', 'order_id', orderId)
    assert.equal(logs.filter((row) => row.event === 'pos.internal.accepted').length, 1)
  })
  await check('the other diner receives the order over Realtime', async () => {
    await waitForEvent(peerEvents, (event) => event.new.id === orderId)
  })
  await check('reusing a request id with different content is rejected', async () => {
    rejected(await edge(customer, { ...originalRequest, notes: 'Changed payload' }), [409], 'IDEMPOTENCY_CONFLICT')
  })

  let savedItem
  await check('the transaction persists participant, shared flag and complete snapshots', async () => {
    const items = await rows(customer, 'order_items', 'order_id', orderId, '*,order_item_modifiers(*),order_item_removed_ingredients(*)')
    assert.equal(items.length, 1)
    savedItem = items[0]
    const user = unwrap(await customer.auth.getUser(), 'Get diner identity').user
    const actualParticipant = (await rows(customer, 'session_participants', 'session_id', sessionId)).find((row) => row.user_id === user.id)
    assert.ok(actualParticipant)
    assert.equal(savedItem.participant_id, actualParticipant.id)
    assert.equal(savedItem.is_shared, true)
    assert.equal(savedItem.quantity, 2)
    assert.equal(savedItem.product_name, product.name)
    assert.equal(Number(savedItem.base_price), 1250.25)
    assert.equal(Number(savedItem.total_price), 2800)
    assert.equal(savedItem.order_item_modifiers.length, 1)
    assert.equal(savedItem.order_item_modifiers[0].option_name, option.name)
    assert.equal(savedItem.order_item_modifiers[0].group_name, group.name)
    assert.equal(Number(savedItem.order_item_modifiers[0].price_delta), 149.75)
    assert.equal(savedItem.order_item_removed_ingredients[0].ingredient_name, removable.name)
    const order = (await rows(customer, 'orders', 'id', orderId))[0]
    assert.equal(order.submitted_by, actualParticipant.id)
    assert.equal(order.notes, originalRequest.notes)
    assert.ok(order.accepted_at)
  })
  await check('both diners read the shared order and account', async () => {
    assert.equal((await rows(peer, 'orders', 'id', orderId)).length, 1)
    assert.equal((await rows(peer, 'order_items', 'order_id', orderId)).length, 1)
    await assertBill(peer, sessionId, { submitted_amount: 0, total_amount: 2800, paid_amount: 0, pending_amount: 2800, is_settled: false })
  })
  await check('RLS isolates orders, all snapshots and bills from other restaurants', async () => {
    for (const actor of [outsider, otherAdmin]) {
      assert.deepEqual(await rows(actor, 'orders', 'id', orderId), [])
      assert.deepEqual(await rows(actor, 'order_items', 'order_id', orderId), [])
      assert.deepEqual(await rows(actor, 'order_item_modifiers', 'order_item_id', savedItem.id), [])
      assert.deepEqual(await rows(actor, 'order_item_removed_ingredients', 'order_item_id', savedItem.id), [])
      assert.deepEqual(await rows(actor, 'session_bills', 'session_id', sessionId), [])
    }
  })
  await check('diners cannot insert orders or alter prices and states directly', async () => {
    const inserted = await customer.from('orders').insert({ restaurant_id: restaurantId, session_id: sessionId, total_amount: 1 })
    assert.ok(inserted.error)
    const itemInsert = await customer.from('order_items').insert({ order_id: orderId, quantity: 1, product_name: 'Forged', base_price: 0, total_price: 0 })
    assert.ok(itemInsert.error)
    const orderUpdate = await customer.from('orders').update({ total_amount: 1, status: 'delivered' }).eq('id', orderId).select()
    assert.ok(orderUpdate.error || orderUpdate.data.length === 0)
    const itemUpdate = await customer.from('order_items').update({ total_price: 1 }).eq('id', savedItem.id).select()
    assert.ok(itemUpdate.error || itemUpdate.data.length === 0)
    const order = (await rows(customer, 'orders', 'id', orderId))[0]
    assert.equal(Number(order.total_amount), 2800)
    assert.equal(order.status, 'accepted')
  })
  await check('menu changes preserve existing snapshots and idempotent retries', async () => {
    try {
      await update(admin, 'products', product.id, { name: `${title} renamed`, base_price: 9999 })
      await update(admin, 'modifier_groups', group.id, { name: `${title} renamed group` })
      await update(admin, 'modifier_options', option.id, { name: `${title} renamed option`, price_delta: 999 })
      await update(admin, 'product_ingredients', removable.id, { name: `${title} renamed ingredient` })
      const stored = (await rows(peer, 'order_items', 'order_id', orderId, '*,order_item_modifiers(*),order_item_removed_ingredients(*)'))[0]
      assert.deepEqual(stored, savedItem)
      const replay = successful(await edge(customer, originalRequest))
      assert.equal(replay.orderId, orderId)
      assert.equal(Number(replay.totalAmount), 2800)
      rejected(await edge(customer, request()))
    } finally {
      await update(admin, 'products', product.id, { name: product.name, base_price: product.base_price })
      await update(admin, 'modifier_groups', group.id, { name: group.name })
      await update(admin, 'modifier_options', option.id, { name: option.name, price_delta: option.price_delta })
      await update(admin, 'product_ingredients', removable.id, { name: removable.name })
    }
  })

  const peerRequest = basicRequest()
  let peerOrderId
  await check('submitted orders appear separately before POS acceptance', async () => {
    peerOrderId = unwrap(await peer.rpc('submit_order', {
      p_session_id: sessionId,
      p_request_id: peerRequest.requestId,
      p_items: peerRequest.items,
      p_expected_total: peerRequest.expectedTotal,
      p_notes: peerRequest.notes,
    }), 'Submit order RPC')
    assert.equal((await rows(peer, 'orders', 'id', peerOrderId))[0].status, 'submitted')
    await assertBill(peer, sessionId, { submitted_amount: 1000, total_amount: 2800, paid_amount: 0, pending_amount: 2800 })
  })
  await check('Edge retries dispatch an existing submitted order without duplicating it', async () => {
    const result = successful(await edge(peer, peerRequest))
    assert.equal(result.orderId, peerOrderId)
    assert.equal((await rows(customer, 'orders', 'session_id', sessionId)).length, 2)
    await assertBill(customer, sessionId, { submitted_amount: 0, total_amount: 3800, paid_amount: 0, pending_amount: 3800 })
  })
  await check('only members of the order restaurant can advance its status', async () => {
    for (const actor of [customer, outsider, otherAdmin]) {
      const result = await actor.rpc('transition_order', { p_order_id: orderId, p_status: 'in_preparation' })
      assert.ok(result.error, 'Unauthorized transition must fail')
    }
    assert.equal((await rows(customer, 'orders', 'id', orderId))[0].status, 'accepted')
  })
  await check('order states follow the valid preparation sequence with timestamps', async () => {
    const invalid = await admin.rpc('transition_order', { p_order_id: orderId, p_status: 'delivered' })
    assert.ok(invalid.error, 'Skipping preparation and ready must fail')
    for (const [status, timestamp] of [['in_preparation', 'preparing_at'], ['ready', 'ready_at'], ['delivered', 'delivered_at']]) {
      unwrap(await admin.rpc('transition_order', { p_order_id: orderId, p_status: status }), `Transition to ${status}`)
      const order = (await rows(peer, 'orders', 'id', orderId))[0]
      assert.equal(order.status, status)
      assert.ok(order[timestamp], `${timestamp} is recorded`)
    }
    const terminal = await admin.rpc('transition_order', { p_order_id: orderId, p_status: 'cancelled' })
    assert.ok(terminal.error, 'Delivered orders are terminal')
  })
  await check('Realtime delivers status changes and does not leak cross-restaurant orders', async () => {
    await waitForEvent(peerEvents, (event) => event.new.id === orderId && event.new.status === 'delivered')
    assert.equal(outsiderEvents.length, 0)
  })
  await check('cancelling an accepted order removes its amount from the account', async () => {
    unwrap(await admin.rpc('transition_order', { p_order_id: peerOrderId, p_status: 'cancelled' }), 'Cancel order')
    const order = (await rows(peer, 'orders', 'id', peerOrderId))[0]
    assert.equal(order.status, 'cancelled')
    assert.ok(order.cancelled_at)
    await assertBill(peer, sessionId, { submitted_amount: 0, total_amount: 2800, paid_amount: 0, pending_amount: 2800, is_settled: false })
    const retry = await admin.rpc('transition_order', { p_order_id: peerOrderId, p_status: 'accepted' })
    assert.ok(retry.error, 'Cancelled orders cannot be revived')
  })
  await check('a closed session rejects new orders and retains its existing account', async () => {
    await update(admin, 'table_sessions', sessionId, { status: 'closed', closed_at: new Date().toISOString() })
    rejected(await edge(customer, basicRequest()))
    assert.equal((await rows(customer, 'orders', 'session_id', sessionId)).length, 2)
    await assertBill(customer, sessionId, { total_amount: 2800, pending_amount: 2800 })
  })
} catch (error) {
  failure = error
  console.error(`not ok ${passed + 1} - ${error.message}`)
} finally {
  // Close subscriptions before deleting fixtures to avoid reconnects during cleanup.
  for (const actor of clients) await actor.removeAllChannels().catch(() => {})
  for (const { admin, table, id } of fixtures.reverse()) {
    const result = await admin.from(table).delete().eq('id', id)
    if (result.error) {
      console.error(`Cleanup failed for ${table} ${id}: ${result.error.message}`)
      failure ??= new Error('Fixture cleanup was incomplete')
    }
  }
  if (anonymousIds.length > 0) {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY)
      for (const id of anonymousIds) {
        const result = await service.auth.admin.deleteUser(id)
        if (result.error) {
          console.error(`Anonymous user cleanup failed: ${result.error.message}`)
          failure ??= new Error('Anonymous user cleanup was incomplete')
        }
      }
    } else {
      console.log(`Note: ${anonymousIds.length} anonymous Auth test users remain locally. Set SUPABASE_SERVICE_ROLE_KEY to remove them automatically.`)
    }
  }
  for (const actor of clients) {
    await actor.removeAllChannels().catch(() => {})
    actor.realtime.disconnect()
    await actor.auth.stopAutoRefresh()
  }
}

console.log(`${passed} integration checks passed${failure ? '; suite failed' : '; fixtures removed'}.`)
process.exitCode = failure ? 1 : 0

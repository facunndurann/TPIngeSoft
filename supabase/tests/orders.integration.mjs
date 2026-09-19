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

async function login(email, password = 'demo1234') {
  const result = client()
  unwrap(await result.auth.signInWithPassword({ email, password }), 'Demo admin login')
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
  const [admin, otherAdmin, operator] = await Promise.all([login('admin@esquina.demo'), login('admin@nonna.demo'), login('pos.esquina@employees.example.com', 'demo-pos1234')])
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
  const abandon = (actor, body) => actor.rpc('abandon_order_request', { p_session_id: body.sessionId, p_request_id: body.requestId })
  await check('abandoning a request that already created an order keeps that order', async () => {
    assert.equal(unwrap(await abandon(customer, originalRequest), 'Abandon a landed request'), orderId)
    assert.equal(successful(await edge(customer, originalRequest)).orderId, orderId, 'The original request stays retryable')
  })
  await check('an abandoned request never becomes an order, even if it arrives late', async () => {
    const lateRequest = basicRequest()
    for (const actor of [outsider, otherAdmin]) {
      assert.ok((await abandon(actor, lateRequest)).error, 'Only participants of the session can abandon')
    }
    assert.equal(unwrap(await abandon(customer, lateRequest), 'Abandon an unknown request'), null)
    assert.equal(unwrap(await abandon(customer, lateRequest), 'Abandoning twice is idempotent'), null)

    rejected(await edge(customer, lateRequest), [409], 'REQUEST_ABANDONED')
    const direct = await customer.rpc('submit_order', {
      p_session_id: lateRequest.sessionId,
      p_request_id: lateRequest.requestId,
      p_items: lateRequest.items,
      p_expected_total: lateRequest.expectedTotal,
      p_notes: lateRequest.notes,
    })
    assert.equal(direct.error?.message, 'REQUEST_ABANDONED')
    assert.equal((await rows(customer, 'orders', 'session_id', sessionId)).length, 1)
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
  const posOrderSelect = '*,order_items(*,order_item_modifiers(*),order_item_removed_ingredients(*)),table_sessions!inner(id,status,opened_at,closed_at,table_id,session_participants(id,display_name,joined_at),tables!inner(id,label,branch_id,branch:branches(id,name)))'
  await check('the POS board query returns table, branch, participants and item snapshots', async () => {
    const ticket = unwrap(await admin.from('orders').select(posOrderSelect).eq('id', orderId).single(), 'POS nested order')
    assert.equal(ticket.table_sessions.tables.label, title)
    assert.equal(ticket.table_sessions.tables.branch.name, branch.name)
    assert.equal(ticket.table_sessions.status, 'open')
    assert.ok(ticket.table_sessions.session_participants.length >= 2)
    assert.equal(ticket.order_items[0].product_name, product.name)
    assert.equal(ticket.order_items[0].order_item_modifiers[0].option_name, option.name)
    const board = unwrap(await admin.from('orders').select(posOrderSelect)
      .eq('restaurant_id', restaurantId)
      .or('status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,created_at.gte."2020-01-01T00:00:00.000Z")'), 'POS board filter')
    assert.ok(board.some((row) => row.id === orderId))
    const openSessions = unwrap(await admin.from('table_sessions').select('*,session_participants(id,display_name),tables!inner(id,label,branch_id,branch:branches(id,name))').eq('id', sessionId).single(), 'POS session')
    assert.equal(openSessions.tables.branch.name, branch.name)
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
    for (const actor of [customer, outsider, otherAdmin, admin]) {
      const result = await actor.rpc('transition_order', { p_order_id: orderId, p_status: 'in_preparation' })
      assert.ok(result.error, 'Unauthorized transition must fail')
    }
    assert.equal((await rows(customer, 'orders', 'id', orderId))[0].status, 'accepted')
  })
  await check('order states follow the valid preparation sequence with timestamps', async () => {
    const invalid = await operator.rpc('transition_order', { p_order_id: orderId, p_status: 'delivered' })
    assert.ok(invalid.error, 'Skipping preparation and ready must fail')
    for (const [status, timestamp] of [['in_preparation', 'preparing_at'], ['ready', 'ready_at'], ['delivered', 'delivered_at']]) {
      unwrap(await operator.rpc('transition_order', { p_order_id: orderId, p_status: status }), `Transition to ${status}`)
      const order = (await rows(peer, 'orders', 'id', orderId))[0]
      assert.equal(order.status, status)
      assert.ok(order[timestamp], `${timestamp} is recorded`)
    }
    const terminal = await operator.rpc('transition_order', { p_order_id: orderId, p_status: 'cancelled' })
    assert.ok(terminal.error, 'Delivered orders cannot be cancelled')
  })
  await check('orders step back one stage at a time and timestamps follow the current path', async () => {
    const transition = (status) => operator.rpc('transition_order', { p_order_id: orderId, p_status: status })
    const current = async () => (await rows(peer, 'orders', 'id', orderId))[0]
    const delivered = await current()

    assert.ok((await transition('in_preparation')).error, 'Reverting cannot skip stages')

    unwrap(await transition('ready'), 'Revert to ready')
    let order = await current()
    assert.equal(order.status, 'ready')
    assert.equal(order.delivered_at, null, 'Reverting clears later stages')
    assert.equal(order.ready_at, delivered.ready_at, 'Reverting keeps the target stage timestamp')

    unwrap(await transition('in_preparation'), 'Revert to in_preparation')
    order = await current()
    assert.equal(order.ready_at, null)
    assert.equal(order.preparing_at, delivered.preparing_at, 'Preparation does not restart')

    unwrap(await transition('accepted'), 'Revert to accepted')
    order = await current()
    assert.equal(order.preparing_at, null)
    assert.ok((await transition('submitted')).error, 'Accepted orders cannot return to submitted')
    await assertBill(peer, sessionId, { submitted_amount: 0, total_amount: 3800 }) // revertir no saca el pedido de la cuenta

    // Volver a entregarlo deja el pedido como lo esperan los checks siguientes.
    for (const [status, timestamp] of [['in_preparation', 'preparing_at'], ['ready', 'ready_at'], ['delivered', 'delivered_at']]) {
      unwrap(await transition(status), `Advance again to ${status}`)
      order = await current()
      assert.equal(order.status, status)
      assert.ok(order[timestamp], `${timestamp} is stamped again`)
    }
  })
  await check('Realtime delivers status changes and does not leak cross-restaurant orders', async () => {
    await waitForEvent(peerEvents, (event) => event.new.id === orderId && event.new.status === 'delivered')
    assert.equal(outsiderEvents.length, 0)
  })
  await check('cancelling an accepted order removes its amount from the account', async () => {
    unwrap(await operator.rpc('transition_order', { p_order_id: peerOrderId, p_status: 'cancelled' }), 'Cancel order')
    const order = (await rows(peer, 'orders', 'id', peerOrderId))[0]
    assert.equal(order.status, 'cancelled')
    assert.ok(order.cancelled_at)
    await assertBill(peer, sessionId, { submitted_amount: 0, total_amount: 2800, paid_amount: 0, pending_amount: 2800, is_settled: false })
    const retry = await operator.rpc('transition_order', { p_order_id: peerOrderId, p_status: 'accepted' })
    assert.ok(retry.error, 'Cancelled orders cannot be revived')
  })
  await check('concurrent POS moves to one destination preserve both sessions and audit only the winner', async () => {
    const moveTables = await Promise.all(['source-a', 'source-b', 'destination'].map((suffix) =>
      createFixture(admin, 'tables', {
        restaurant_id: restaurantId, branch_id: branch.id,
        label: `${title}-${suffix}`, qr_token: `integration-${runId}-${suffix}`,
      })))
    // Abrir y mover son acciones de empleado: la cuenta administrativa no opera el salón.
    for (const rpc of ['pos_open_table_session', 'pos_move_table_session']) {
      const denied = await admin.rpc(rpc, { p_table_id: moveTables[0].id,
        p_session_id: sessionId, p_source_table_id: moveTables[0].id,
        p_destination_table_id: moveTables[2].id })
      assert.ok(denied.error, `${rpc} must reject the admin account`)
    }
    const sourceIds = await Promise.all(moveTables.slice(0, 2).map(async (source) =>
      unwrap(await operator.rpc('pos_open_table_session', { p_table_id: source.id }), 'Open move source')))
    const results = await Promise.all(sourceIds.map((id, index) =>
      operator.rpc('pos_move_table_session', {
        p_session_id: id, p_source_table_id: moveTables[index].id,
        p_destination_table_id: moveTables[2].id,
      })))
    assert.equal(results.filter((result) => !result.error).length, 1)
    const winner = results.findIndex((result) => !result.error)
    const loser = 1 - winner
    assert.equal(results[loser].error.message, 'TABLE_OCCUPIED')
    const moved = (await rows(admin, 'table_sessions', 'id', sourceIds[winner]))[0]
    const unchanged = (await rows(admin, 'table_sessions', 'id', sourceIds[loser]))[0]
    assert.equal(moved.table_id, moveTables[2].id)
    assert.equal(unchanged.table_id, moveTables[loser].id)
    assert.equal(moved.status, 'open')
    assert.equal(unchanged.status, 'open')
    assert.equal((await rows(admin, 'table_sessions', 'table_id', moveTables[winner].id)).length, 0)
    const audit = (await rows(admin, 'pos_audit_log', 'session_id', moved.id))
      .filter((entry) => entry.action === 'session.moved')
    assert.equal(audit.length, 1)
    assert.equal(audit[0].details.sourceTableId, moveTables[winner].id)
    assert.equal(audit[0].details.destinationTableId, moveTables[2].id)
    assert.equal((await rows(admin, 'pos_audit_log', 'session_id', unchanged.id))
      .filter((entry) => entry.action === 'session.moved').length, 0)
  })

  await check('diners and other restaurants cannot close a table session', async () => {
    for (const actor of [customer, outsider, otherAdmin, admin]) {
      const result = await actor.rpc('close_table_session', { p_session_id: sessionId })
      assert.ok(result.error, 'Unauthorized session close must fail')
    }
    assert.equal((await rows(admin, 'table_sessions', 'id', sessionId))[0].status, 'open')
  })
  await check('members cannot write session status directly', async () => {
    const result = await admin.from('table_sessions').update({ status: 'closed' }).eq('id', sessionId).select()
    assert.ok(result.error || result.data.length === 0)
    assert.equal((await rows(admin, 'table_sessions', 'id', sessionId))[0].status, 'open')
  })
  const sessionEvents = []
  const sessionChannel = customer.channel(`integration-session-${randomUUID()}`).on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${sessionId}`,
  }, (event) => sessionEvents.push(event))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Session Realtime subscription timed out')), 12_000)
    sessionChannel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`Realtime ${status}: ${error?.message ?? 'check local Realtime service'}`))
      }
    })
  })
  await check('closing a session is idempotent, leaves kitchen tickets and the bill, and opens a new QR session', async () => {
    unwrap(await operator.rpc('close_table_session', { p_session_id: sessionId }), 'Close table session')
    unwrap(await operator.rpc('close_table_session', { p_session_id: sessionId }), 'Idempotent close')
    const closed = (await rows(admin, 'table_sessions', 'id', sessionId))[0]
    assert.equal(closed.status, 'closed')
    assert.ok(closed.closed_at)
    const logs = await rows(admin, 'integration_logs', 'restaurant_id', restaurantId)
    assert.equal(logs.filter((row) => row.event === 'session.closed' && row.payload?.sessionId === sessionId).length, 1)
    assert.equal((await rows(customer, 'orders', 'id', orderId))[0].status, 'delivered')
    rejected(await edge(customer, basicRequest()))
    assert.equal((await rows(customer, 'orders', 'session_id', sessionId)).length, 2)
    await assertBill(customer, sessionId, { total_amount: 2800, pending_amount: 2800 })
    const reopened = unwrap(
      await customer.rpc('join_table_session', { qr: table.qr_token, participant_name: 'Test diner 1' }),
      'Rejoin after close',
    )
    assert.notEqual(reopened, sessionId)
    assert.equal((await rows(admin, 'table_sessions', 'id', reopened))[0].status, 'open')
  })
  await check('the diner receives the session closure over Realtime', async () => {
    await waitForEvent(sessionEvents, (event) => event.new.id === sessionId && event.new.status === 'closed')
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

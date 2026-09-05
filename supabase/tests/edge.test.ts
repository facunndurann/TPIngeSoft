import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitOrderSchema } from '../../packages/shared/src/orders.ts'
import { createSubmitOrderHandler } from '../functions/submit-order/handler.ts'
import { databaseError } from '../functions/_shared/errors.ts'
import type { OrderGateway, PosOrder } from '../functions/_shared/pos/adapter.ts'

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false }],
  expectedTotal: 20.2,
}
const request = (body: unknown = input, headers: Record<string, string> = { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }) => new Request('http://local/submit-order', { method: 'POST', headers, body: JSON.stringify(body) })
function fixture() {
  let status: PosOrder['status'] = 'submitted'
  let sends = 0
  let creates = 0
  const gateway: OrderGateway = {
    submit: async () => { creates++; return input.requestId },
    loadOrder: async () => ({ id: input.requestId, status, total_amount: 20.2 } as PosOrder),
    posType: async () => 'internal',
    dispatchInternal: async () => { sends++; status = 'accepted' },
  }
  return { gateway, sends: () => sends, creates: () => creates }
}

test('schema rejects forged amounts, attribution, invalid quantities and duplicate selections', () => {
  assert.equal(submitOrderSchema.safeParse(input).success, true)
  for (const value of [NaN, Infinity, -1, .001, 100000000]) assert.equal(submitOrderSchema.safeParse({ ...input, expectedTotal: value }).success, false)
  for (const quantity of [0, 1.5, 100, '2']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity }] }).success, false)
  for (const field of ['optionIds', 'removedIds']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], [field]: [input.sessionId, input.sessionId] }] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, participantId: input.sessionId }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], basePrice: 0 }] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: Array(51).fill(input.items[0]) }).success, false)
})

test('preflight and wrong method never authenticate or create orders', async () => {
  const handler = createSubmitOrderHandler(async () => { throw new Error('should not authenticate') })
  const preflight = await handler(new Request('http://local', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('Access-Control-Allow-Headers')!, /authorization/)
  assert.equal((await handler(new Request('http://local'))).status, 405)
})

test('requires a verified identity and valid bounded JSON', async () => {
  const { gateway, creates } = fixture()
  const handler = createSubmitOrderHandler(async jwt => {
    if (jwt !== 'valid-user') throw databaseError({ message: 'AUTH_REQUIRED' })
    return gateway
  })
  assert.equal((await handler(request(input, { 'Content-Type': 'application/json' }))).status, 401)
  assert.equal((await handler(request(input, { Authorization: 'Bearer forged', 'Content-Type': 'application/json' }))).status, 401)
  assert.equal((await handler(request({ ...input, items: [] }))).status, 400)
  assert.equal((await handler(request('x'.repeat(128 * 1024)))).status, 413)
  const malformed = new Request('http://local', { method: 'POST', headers: { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }, body: '{' })
  assert.equal((await handler(malformed)).status, 400)
  assert.equal(creates(), 0)
})

test('dispatches through the internal adapter and returns server prices and status', async () => {
  const { gateway, sends } = fixture()
  const handler = createSubmitOrderHandler(async () => gateway)
  const result = await handler(request())
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { orderId: input.requestId, status: 'accepted', totalAmount: 20.2 })
  await handler(request())
  assert.equal(sends(), 1, 'an already received order must not be dispatched again')
})

test('price changes do not dispatch, errors retain a safe actionable code', async () => {
  const { gateway, sends } = fixture()
  gateway.submit = async () => { throw databaseError({ message: 'PRICE_CHANGED' }) }
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'PRICE_CHANGED')
  assert.equal(sends(), 0)
})

test('adapter failure preserves submission and retry delivers the same order', async () => {
  const { gateway, sends } = fixture()
  const dispatch = gateway.dispatchInternal
  gateway.dispatchInternal = async () => { throw new Error('private backend detail') }
  const handler = createSubmitOrderHandler(async () => gateway)
  const failed = await handler(request())
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /private backend detail/)
  gateway.dispatchInternal = dispatch
  const retry = await handler(request())
  assert.equal((await retry.json()).orderId, input.requestId)
  assert.equal(sends(), 1)
})

test('unsupported POS is explicit and never silently falls back to internal', async () => {
  const { gateway, sends } = fixture()
  gateway.posType = async () => 'fudo'
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'POS_UNSUPPORTED')
  assert.equal(sends(), 0)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { submitOrderErrorSchema, submitOrderResultSchema, submitOrderSchema } from '../../packages/shared/src/orders.ts'
import { appErrorMessage, appErrors, isRetryableError } from '../../packages/shared/src/errors.ts'
import { posActions } from '../../packages/shared/src/pos.ts'
import { DEFAULT_MENU_DESIGN } from '../../packages/shared/src/designs.ts'
// Si otra migración cambia el default de restaurants.menu_design, apuntá este import a esa.
import menuDesignEnumSql from '../migrations/20260915150000_menu_design_enum.sql?raw'
import { createSubmitOrderHandler } from '../functions/submit-order/handler.ts'
import { databaseError, OrderError } from '../functions/_shared/errors.ts'
import type { OrderGateway } from '../functions/_shared/order-gateway.ts'

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false }],
  expectedTotal: 20.2,
}
const request = (body: unknown = input, headers: Record<string, string> = { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }) => new Request('http://local/submit-order', { method: 'POST', headers, body: JSON.stringify(body) })
const accepted = { orderId: input.requestId, status: 'accepted', totalAmount: 20.2 } as const
function fixture() {
  let creates = 0
  const gateway: OrderGateway = {
    submit: async () => { creates++; return accepted },
  }
  return { gateway, creates: () => creates }
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
    if (jwt !== 'valid-user') throw new OrderError('AUTH_REQUIRED')
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

test('returns the order status and total confirmed by submit_order', async () => {
  const { gateway, creates } = fixture()
  const result = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), accepted)
  assert.equal(creates(), 1)
})

test('database errors answer with the status, code and message of the shared catalog', async () => {
  const { gateway } = fixture()
  const handler = createSubmitOrderHandler(async () => gateway)
  for (const code of ['PRICE_CHANGED', 'REQUEST_ABANDONED', 'POS_UNAVAILABLE'] as const) {
    gateway.submit = async () => { throw databaseError({ message: code }) }
    const response = await handler(request())
    assert.equal(response.status, appErrors[code].status)
    const body = submitOrderErrorSchema.parse(await response.json())
    assert.deepEqual(body.error, { code, message: appErrors[code].message })
  }
})

test('successful responses match the shared result schema', async () => {
  const { gateway } = fixture()
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.deepEqual(submitOrderResultSchema.parse(await response.json()), accepted)
  assert.equal(submitOrderResultSchema.safeParse({ ...accepted, status: 'lost' }).success, false)
  assert.equal(submitOrderResultSchema.safeParse({ ...accepted, totalAmount: '20.2' }).success, false)
})

test('unexpected failures never leak backend details', async () => {
  const { gateway } = fixture()
  gateway.submit = async () => { throw new Error('private backend detail') }
  const failed = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(failed.status, 503)
  const body = await failed.text()
  assert.doesNotMatch(body, /private backend detail/)
  assert.equal(JSON.parse(body).error.code, 'SERVER_ERROR')
})

test('POS actions advance and cancel until delivery, and nothing leaves cancelled', () => {
  assert.equal(posActions.accepted.advance?.to, 'in_preparation')
  assert.equal(posActions.ready.cancel?.to, 'cancelled')
  assert.equal(posActions.delivered.advance, undefined)
  assert.equal(posActions.delivered.cancel, undefined)
  assert.deepEqual(posActions.cancelled, {})
})

test('reverting steps back exactly one stage, never to submitted nor from cancelled', () => {
  // Que estos pares coincidan con la tabla order_status_transitions lo verifica
  // supabase/tests/orders.integration.mjs contra la base.
  assert.deepEqual(
    Object.entries(posActions).flatMap(([from, { revert }]) => (revert ? [`${from} -> ${revert.to}`] : [])),
    ['in_preparation -> accepted', 'ready -> in_preparation', 'delivered -> ready'],
  )
})

test('the error catalog decides which failures keep a submission for retry', () => {
  // Rechazos definitivos: liberan el envío para que el comensal revise el carrito.
  for (const code of ['PRICE_CHANGED', 'SESSION_CLOSED', 'IDEMPOTENCY_CONFLICT', 'REQUEST_ABANDONED']) {
    assert.equal(isRetryableError(code), false, code)
  }
  // Fallas transitorias y códigos desconocidos (red caída): el envío se conserva.
  for (const code of ['POS_UNAVAILABLE', 'SERVER_ERROR', 'AUTH_REQUIRED', 'CONNECTION_ERROR']) {
    assert.equal(isRetryableError(code), true, code)
  }
  assert.equal(appErrorMessage('STALE_DATA', 'fallback'), appErrors.STALE_DATA.message)
  assert.equal(appErrorMessage('P0001: INVALID_TRANSITION', 'fallback'), 'fallback')
})

test('the database default menu design matches DEFAULT_MENU_DESIGN', () => {
  assert.equal(menuDesignEnumSql.match(/alter column menu_design set default '(\w+)'/)?.[1], DEFAULT_MENU_DESIGN)
})

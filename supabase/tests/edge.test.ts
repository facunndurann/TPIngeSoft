import { test } from 'vitest'
import assert from 'node:assert/strict'
import { submitOrderResultSchema } from '../../packages/shared/src/orders.ts'
import { AppError, appErrorBodySchema, appErrors, fromPostgres } from '../../packages/shared/src/errors.ts'
import { createSubmitOrderHandler, type OrderGateway } from '../functions/submit-order/handler.ts'
import { createMobilePaymentHandler, type MobilePaymentGateway } from '../functions/mobile-payment/handler.ts'

// El contrato HTTP de las Edge Functions, con gateways falsos: la lógica que usan
// (schemas, catálogo de errores) se prueba en packages/shared/tests, junto a su código.

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  items: [
    { productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false },
  ],
  expectedTotal: 20.2,
}
const request = (
  body: unknown = input,
  headers: Record<string, string> = { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' },
) => new Request('http://local/submit-order', { method: 'POST', headers, body: JSON.stringify(body) })
const accepted = { orderId: input.requestId, status: 'accepted', totalAmount: 20.2 } as const
function fixture() {
  let creates = 0
  const gateway: OrderGateway = {
    submit: async () => {
      creates++
      return accepted
    },
  }
  return { gateway, creates: () => creates }
}

test('preflight and wrong method never authenticate or create orders', async () => {
  const handler = createSubmitOrderHandler(async () => {
    throw new Error('should not authenticate')
  })
  const preflight = await handler(new Request('http://local', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('Access-Control-Allow-Headers')!, /authorization/)
  assert.equal((await handler(new Request('http://local'))).status, 405)
})

test('requires a verified identity and valid bounded JSON', async () => {
  const { gateway, creates } = fixture()
  const handler = createSubmitOrderHandler(async (jwt) => {
    if (jwt !== 'valid-user') throw new AppError('AUTH_REQUIRED')
    return gateway
  })
  assert.equal((await handler(request(input, { 'Content-Type': 'application/json' }))).status, 401)
  assert.equal(
    (await handler(request(input, { Authorization: 'Bearer forged', 'Content-Type': 'application/json' }))).status,
    401,
  )
  assert.equal((await handler(request({ ...input, items: [] }))).status, 400)
  assert.equal((await handler(request('x'.repeat(128 * 1024)))).status, 413)
  const malformed = new Request('http://local', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' },
    body: '{',
  })
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
    gateway.submit = async () => {
      throw fromPostgres({ message: code })
    }
    const response = await handler(request())
    assert.equal(response.status, appErrors[code].status)
    const body = appErrorBodySchema.parse(await response.json())
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
  gateway.submit = async () => {
    throw new Error('private backend detail')
  }
  const failed = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(failed.status, 503)
  const body = await failed.text()
  assert.doesNotMatch(body, /private backend detail/)
  const { code, message } = JSON.parse(body).error
  assert.equal(code, 'SERVER_ERROR')
  // El envío pide reintentar el mismo requestId: el catálogo ya no lo dice por él.
  assert.equal(message, 'No pudimos confirmar el resultado. Reintentá el mismo envío para evitar duplicados.')
})

test('mobile payment endpoint creates and reads status; client confirmation is forbidden', async () => {
  const calls: string[] = []
  const gateway: MobilePaymentGateway = {
    execute: async (input) => {
      calls.push(input.action)
      return {
        paymentId: input.action === 'create' ? input.requestId : input.paymentId,
        amount: 1250,
        status: input.action === 'create' ? 'pending' : 'approved',
      }
    },
  }
  const handler = createMobilePaymentHandler(async (token) => {
    if (token !== 'valid-user') throw new AppError('AUTH_REQUIRED')
    return gateway
  })
  const paymentId = '00000000-0000-4000-8000-000000000010'
  const mobileRequest = (body: unknown, token = 'valid-user') =>
    new Request('http://local/mobile-payment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const created = await handler(mobileRequest({ action: 'create', sessionId: input.sessionId, requestId: paymentId }))
  assert.equal(created.status, 201)
  assert.deepEqual(await created.json(), { paymentId, amount: 1250, status: 'pending' })
  assert.equal((await handler(mobileRequest({ action: 'confirm', paymentId, outcome: 'approved' }))).status, 400)
  const approved = await handler(mobileRequest({ action: 'status', paymentId }))
  assert.equal(approved.status, 200)
  assert.deepEqual(await approved.json(), { paymentId, amount: 1250, status: 'approved' })
  const byItems = await handler(
    mobileRequest({
      action: 'create',
      sessionId: input.sessionId,
      requestId: paymentId,
      mode: 'custom',
      itemIds: [input.sessionId],
    }),
  )
  assert.equal(byItems.status, 201)
  assert.deepEqual(calls, ['create', 'status', 'create'])
  assert.equal((await handler(mobileRequest({ action: 'create', sessionId: 'bad', requestId: paymentId }))).status, 400)
  assert.equal((await handler(mobileRequest({ action: 'confirm', paymentId, outcome: 'invented' }))).status, 400)
  assert.equal(
    (
      await handler(
        mobileRequest({ action: 'create', sessionId: input.sessionId, requestId: paymentId, mode: 'custom' }),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await handler(
        mobileRequest({
          action: 'create',
          sessionId: input.sessionId,
          requestId: paymentId,
          mode: 'full',
          itemIds: [paymentId],
        }),
      )
    ).status,
    400,
  )
  assert.equal(
    (await handler(mobileRequest({ action: 'create', sessionId: input.sessionId, requestId: paymentId }, 'forged')))
      .status,
    401,
  )
})

test('mobile payment endpoint handles preflight and never leaks provider failures', async () => {
  const handler = createMobilePaymentHandler(async () => ({
    execute: async () => {
      throw new Error('provider secret')
    },
  }))
  assert.equal((await handler(new Request('http://local', { method: 'OPTIONS' }))).status, 204)
  const wrongMethod = await handler(new Request('http://local'))
  assert.equal(wrongMethod.status, 405)
  assert.deepEqual(appErrorBodySchema.parse(await wrongMethod.json()).error, {
    code: 'METHOD_NOT_ALLOWED',
    message: 'Usá POST para iniciar un pago.',
  })
  const response = await handler(
    new Request('http://local', {
      method: 'POST',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: '{',
    }),
  )
  assert.equal(response.status, 400)
  assert.doesNotMatch(await response.text(), /provider secret/)
})

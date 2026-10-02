import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { AppError } from '../../packages/shared/src/errors.ts'
import {
  checkoutGateway,
  checkoutSettings,
  verifyPayment,
  type CheckoutContext,
  type CheckoutProvider,
  type CheckoutRepository,
  type ProviderPayment,
} from '../functions/mobile-payment/checkout.ts'
import { mercadoPagoProvider } from '../functions/mobile-payment/provider.ts'
import { createMercadoPagoWebhook } from '../functions/mercado-pago-webhook/handler.ts'

afterEach(() => vi.restoreAllMocks())

const localId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const settings = {
  appUrl: 'https://menu.example.com',
  webhookUrl: 'https://project.supabase.co/functions/v1/mercado-pago-webhook',
}
const createRequest = { action: 'create', sessionId: localId, requestId: userId, mode: 'full' } as const
const approved: ProviderPayment = {
  id: 123,
  collector_id: 456,
  external_reference: localId,
  currency_id: 'ARS',
  transaction_amount: 1250,
  transaction_amount_refunded: 0,
  status: 'approved',
  date_last_updated: '2026-10-02T12:00:00Z',
}

function fixture(state = 'creating') {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const context: CheckoutContext = {
    payment_id: localId,
    session_id: localId,
    restaurant_id: localId,
    branch_id: localId,
    qr_token: 'table-qr',
    amount: 1250,
    status: 'pending',
    currency_id: 'ARS',
    external_reference: localId,
    environment: 'test',
    access_token: 'private-access-token',
    webhook_secret: 'private-webhook-secret',
    checkout_state: state,
    lease_token: userId,
    preference_id: null,
    checkout_url: null,
    collector_id: null,
    mp_payment_id: null,
    provider_status: null,
  }
  const preference = {
    id: '456-preference',
    collector_id: 456,
    init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=456-preference',
    external_reference: localId,
    items: [{ quantity: 1, unit_price: 1250, currency_id: 'ARS' }],
  }
  const repository: CheckoutRepository = {
    rateLimit: vi.fn(async () => {}),
    create: vi.fn(async () => localId),
    claim: vi.fn(async () => ({ ...context })),
    resolve: vi.fn(async () => ({ ...context })),
    complete: vi.fn(async (_context, pref) => {
      Object.assign(context, {
        checkout_state: 'ready',
        preference_id: pref.id,
        checkout_url: pref.init_point,
        collector_id: String(pref.collector_id),
      })
    }),
    fail: vi.fn(async (_context, definitive) => {
      context.checkout_state = definitive ? 'failed' : 'uncertain'
      if (definitive) context.status = 'cancelled'
    }),
    apply: vi.fn(async (_context, payment) => {
      context.status = payment.status === 'approved' ? 'approved' : 'pending'
      context.provider_status = payment.status
    }),
  }
  const provider: CheckoutProvider = {
    create: vi.fn(async () => preference),
    findPreference: vi.fn(async () => preference),
    findPayments: vi.fn(async () => []),
    getPayment: vi.fn(async () => approved),
  }
  const factory = vi.fn(() => provider)
  return {
    context,
    preference,
    repository,
    provider,
    factory,
    gateway: checkoutGateway(repository, factory, settings, userId),
  }
}

test('HTTPS configuration rejects HTTP, credentials, query injection and wrong endpoint paths', () => {
  assert.deepEqual(checkoutSettings(settings.appUrl, settings.webhookUrl), settings)
  for (const app of [
    'http://example.com',
    'https://secret@example.com',
    'https://example.com/x',
    'https://example.com?return=evil',
  ]) {
    assert.throws(() => checkoutSettings(app, settings.webhookUrl))
  }
  assert.throws(() => checkoutSettings(settings.appUrl, 'https://project.supabase.co/unrelated'))
})

test('checkout uses server-calculated amount and exposes only safe redirect/status fields', async () => {
  const { gateway, repository, context, factory } = fixture()
  const result = await gateway.execute(createRequest)
  assert.equal(result.amount, 1250)
  assert.equal(result.status, 'pending')
  assert.equal(result.checkoutUrl, context.checkout_url)
  assert.equal(vi.mocked(repository.rateLimit).mock.calls[0][0], userId)
  assert.equal(vi.mocked(factory).mock.calls[0][0], context.access_token)
  assert.doesNotMatch(JSON.stringify(result), /private-|secret|access_token|lease_token/)
})

test('repeated create reuses saved preference; rate limiting fails before any payment/API writes', async () => {
  const { gateway, provider, repository } = fixture()
  await gateway.execute(createRequest)
  await gateway.execute(createRequest)
  assert.equal(vi.mocked(provider.create).mock.calls.length, 1)
  vi.mocked(repository.rateLimit).mockRejectedValueOnce(new AppError('PAYMENT_RATE_LIMITED'))
  await assert.rejects(gateway.execute(createRequest), { code: 'PAYMENT_RATE_LIMITED' })
  assert.equal(vi.mocked(repository.create).mock.calls.length, 2)
})

test('POST timeout becomes uncertain and recovery searches/adopts without another POST', async () => {
  const { gateway, repository, provider, context } = fixture()
  vi.mocked(provider.create).mockRejectedValueOnce(new Error('timeout'))
  await assert.rejects(gateway.execute(createRequest), { code: 'CHECKOUT_UNCERTAIN' })
  assert.equal(context.checkout_state, 'uncertain')
  assert.equal(vi.mocked(repository.fail).mock.calls[0][1], false)
  const recovered = await gateway.execute({ action: 'status', paymentId: localId })
  assert.ok(recovered.checkoutUrl)
  assert.equal(vi.mocked(provider.create).mock.calls.length, 1)
  assert.equal(vi.mocked(provider.findPreference).mock.calls.length, 1)
})

test('empty recovery search never recreates remotely; definitive rejection releases the local reservation', async () => {
  const uncertain = fixture('uncertain')
  vi.mocked(uncertain.provider.findPreference).mockResolvedValueOnce(null)
  await assert.rejects(uncertain.gateway.execute(createRequest), { code: 'CHECKOUT_UNCERTAIN' })
  assert.equal(vi.mocked(uncertain.provider.create).mock.calls.length, 0)
  const rejected = fixture()
  vi.mocked(rejected.provider.create).mockRejectedValueOnce({ status: 400, message: 'private provider details' })
  await assert.rejects(rejected.gateway.execute(createRequest), { code: 'PAYMENT_PROVIDER_UNAVAILABLE' })
  assert.equal(rejected.context.status, 'cancelled')
})

test('missing signing secret prevents a remote checkout; successful POST plus DB failure stays uncertain', async () => {
  const missing = fixture()
  missing.context.webhook_secret = ''
  await assert.rejects(missing.gateway.execute(createRequest), { code: 'PAYMENT_PROVIDER_UNAVAILABLE' })
  assert.equal(vi.mocked(missing.provider.create).mock.calls.length, 0)
  const failed = fixture()
  vi.mocked(failed.repository.complete).mockRejectedValueOnce(new Error('database disconnected'))
  await assert.rejects(failed.gateway.execute(createRequest), /database disconnected/)
  assert.equal(vi.mocked(failed.repository.fail).mock.calls[0][1], false)
})

test('provider preferences are checked for amount, currency, external reference and destination before saving', async () => {
  for (const change of [
    { external_reference: userId },
    { init_point: 'https://evil.example/checkout' },
    { items: [{ unit_price: 100, quantity: 1, currency_id: 'ARS' }] },
    { items: [{ unit_price: 1250, quantity: 1, currency_id: 'USD' }] },
  ]) {
    const { gateway, provider, preference, repository } = fixture()
    vi.mocked(provider.create).mockResolvedValueOnce({ ...preference, ...change })
    await assert.rejects(gateway.execute(createRequest), { code: 'PAYMENT_VERIFICATION_FAILED' })
    assert.equal(vi.mocked(repository.complete).mock.calls.length, 0)
  }
})

test('status verifies collector, amount, currency, local reference, dates and refunds before applying', async () => {
  const { gateway, context, provider } = fixture()
  await gateway.execute(createRequest)
  for (const change of [
    { collector_id: 789 },
    { external_reference: userId },
    { currency_id: 'USD' },
    { transaction_amount: 1 },
    { transaction_amount: NaN },
    { transaction_amount_refunded: -1 },
    { transaction_amount_refunded: 1251 },
    { date_last_updated: 'invalid' },
    { status: 'made_up' },
  ])
    assert.throws(() => verifyPayment(context, { ...approved, ...change }), { code: 'PAYMENT_VERIFICATION_FAILED' })
  vi.mocked(provider.findPayments).mockResolvedValueOnce([{ ...approved, id: '123', collector_id: '456' }])
  const result = await gateway.execute({ action: 'status', paymentId: localId })
  assert.equal(result.status, 'approved')
  assert.equal(result.checkoutUrl, undefined)
})

function notification(
  secret = 'private-webhook-secret',
  overrides: { dataId?: string; bodyId?: string; paymentId?: string; signature?: string; padding?: string } = {},
) {
  const dataId = overrides.dataId ?? '123'
  const requestId = 'request-123'
  const ts = '1742505638683' // Official millisecond example; old authentic retries are still accepted.
  const digest = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')
  return new Request(
    `${settings.webhookUrl}?payment_id=${overrides.paymentId ?? localId}&data.id=${dataId}&type=payment`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-signature': overrides.signature ?? `ts=${ts},v1=${digest}`,
      },
      body: JSON.stringify({ type: 'payment', data: { id: overrides.bodyId ?? dataId }, padding: overrides.padding }),
    },
  )
}

test('webhooks verify real SDK HMAC, fetch signed ID and commit before acknowledgement, including old retries', async () => {
  const { gateway, repository, provider, factory } = fixture()
  await gateway.execute(createRequest)
  const handler = createMercadoPagoWebhook(repository, factory)
  for (let i = 0; i < 3; i++) assert.equal((await handler(notification())).status, 200)
  assert.equal(vi.mocked(provider.getPayment).mock.calls[0][0], '123')
  assert.equal(vi.mocked(repository.apply).mock.calls.length, 3)
  vi.mocked(repository.apply).mockRejectedValueOnce(new Error('database unavailable private-secret'))
  const failed = await handler(notification())
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /private-secret|database/)
})

test('forged signatures, mixed body/query IDs, excessive bodies, and wrong methods never retrieve payments', async () => {
  const { gateway, repository, factory, provider } = fixture()
  await gateway.execute(createRequest)
  const handler = createMercadoPagoWebhook(repository, factory)
  assert.equal((await handler(notification('wrong-secret'))).status, 401)
  assert.equal((await handler(notification(undefined, { signature: 'invalid' }))).status, 401)
  assert.equal((await handler(notification(undefined, { bodyId: '456' }))).status, 400)
  assert.equal((await handler(notification(undefined, { paymentId: 'invalid' }))).status, 400)
  assert.equal((await handler(notification(undefined, { padding: 'x'.repeat(20 * 1024) }))).status, 413)
  assert.equal((await handler(new Request(settings.webhookUrl))).status, 405)
  assert.equal(vi.mocked(provider.getPayment).mock.calls.length, 0)
})

test('valid signature cannot route an unrelated provider payment to a local checkout', async () => {
  const { gateway, repository, factory, provider } = fixture()
  await gateway.execute(createRequest)
  vi.mocked(provider.getPayment).mockResolvedValueOnce({ ...approved, external_reference: userId })
  assert.equal((await createMercadoPagoWebhook(repository, factory)(notification())).status, 409)
  assert.equal(vi.mocked(repository.apply).mock.calls.length, 0)
})

test('official SDK adapter sends documented preference fields and never retries a failed POST', async () => {
  const { context, preference } = fixture()
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(preference), { status: 201 }))
  const provider = mercadoPagoProvider(context.access_token)
  await provider.create(context, settings)
  const [url, init] = fetch.mock.calls[0]
  assert.equal(String(url).replace(/\/$/, ''), 'https://api.mercadopago.com/checkout/preferences')
  assert.equal(init?.method, 'POST')
  const body = JSON.parse(String(init?.body))
  assert.equal(body.items[0].unit_price, context.amount)
  assert.equal(body.items[0].currency_id, 'ARS')
  assert.equal(body.external_reference, localId)
  assert.equal(body.back_urls.success, 'https://menu.example.com/m/table-qr/cuenta')
  assert.equal(new URL(body.notification_url).searchParams.get('payment_id'), localId)
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'provider failed' }), { status: 500 }))
  await assert.rejects(provider.create(context, settings))
  assert.equal(fetch.mock.calls.length, 2)
})

test('SDK recovery uses documented searches and refuses ambiguous preferences or truncated payment history', async () => {
  const { preference } = fixture()
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 1, elements: [{ id: preference.id, external_reference: localId }] })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(preference)))
  const provider = mercadoPagoProvider('server-token')
  assert.equal((await provider.findPreference(localId))?.id, preference.id)
  assert.equal(new URL(String(fetch.mock.calls[0][0])).pathname, '/checkout/preferences/search')
  assert.equal(new URL(String(fetch.mock.calls[0][0])).searchParams.get('external_reference'), localId)
  assert.equal(new URL(String(fetch.mock.calls[1][0])).pathname, `/checkout/preferences/${preference.id}`)
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ total: 2, elements: [] })))
  await assert.rejects(provider.findPreference(localId), { code: 'PAYMENT_RECONCILIATION_REQUIRED' })
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 51 }, results: [] })))
  await assert.rejects(provider.findPayments(localId), { code: 'PAYMENT_RECONCILIATION_REQUIRED' })
})

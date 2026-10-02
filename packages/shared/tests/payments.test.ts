import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  acceptsPaymentMethod,
  isMercadoPagoCheckoutUrl,
  mobilePaymentRequestSchema,
  mobilePaymentResultSchema,
  enabledPaymentMethods,
  paymentMethodDescriptions,
  paymentMethodLabels,
  paymentMethods,
  paymentProviderConfigInputSchema,
  paymentProviderEnvironmentLabels,
} from '../src/payments.ts'

test('a branch offers only the payment methods it enabled', () => {
  assert.deepEqual(enabledPaymentMethods(null), [])
  assert.deepEqual(enabledPaymentMethods({ payment_methods: null }), [])
  // Se recorre el catálogo, no la columna: el orden guardado y un repetido no
  // llegan a la pantalla.
  assert.deepEqual(enabledPaymentMethods({ payment_methods: ['external', 'mobile', 'external'] }), [
    'mobile',
    'external',
  ])
  assert.equal(acceptsPaymentMethod({ payment_methods: ['in_person'] }, 'in_person'), true)
  assert.equal(acceptsPaymentMethod({ payment_methods: ['in_person'] }, 'mobile'), false)
  // Un local puede no cobrar por la app: el comensal solo pide la cuenta.
  assert.deepEqual(enabledPaymentMethods({ payment_methods: [] }), [])

  for (const method of paymentMethods) {
    assert.ok(paymentMethodLabels[method])
    assert.ok(paymentMethodDescriptions[method])
  }
})

test('provider configuration keeps provider credentials separate from payment methods and modes', () => {
  const input = paymentProviderConfigInputSchema.parse({
    restaurantId: '00000000-0000-4000-8000-000000000001',
    environment: 'test',
    branchIds: ['00000000-0000-4000-8000-000000000002'],
    accessToken: 'APP_USR-this-is-a-test-token',
  })
  assert.equal(input.environment, 'test')
  assert.deepEqual(input.branchIds, ['00000000-0000-4000-8000-000000000002'])
  assert.equal(paymentProviderEnvironmentLabels.production, 'Producción')
  assert.throws(() =>
    paymentProviderConfigInputSchema.parse({
      ...input,
      accessToken: 'too short',
    }),
  )
})

const paymentId = '00000000-0000-4000-8000-000000000003'
const attempt = {
  request: {
    action: 'create',
    sessionId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000004',
    mode: 'full',
  },
}

test('the browser can request status but can never confirm a payment or send an amount', () => {
  assert.deepEqual(mobilePaymentRequestSchema.parse({ action: 'status', paymentId }), { action: 'status', paymentId })
  for (const request of [
    { action: 'confirm', paymentId, outcome: 'approved' },
    { action: 'status', paymentId, outcome: 'approved' },
    { ...attempt.request, amount: 1 },
    { ...attempt.request, mode: 'custom' },
    { ...attempt.request, itemIds: [paymentId] },
  ])
    assert.equal(mobilePaymentRequestSchema.safeParse(request).success, false)
})

test('checkout destinations reject insecure URLs, lookalike hosts, credentials and unrelated paths', () => {
  const valid = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc'
  assert.equal(isMercadoPagoCheckoutUrl(valid), true)
  assert.equal(isMercadoPagoCheckoutUrl('https://www.mercadopago.com/mla/checkout/start?pref_id=123'), true)
  for (const url of [
    'http://www.mercadopago.com.ar/checkout/v1/redirect',
    'https://www.mercadopago.com.ar.evil.example/checkout/v1/redirect',
    'https://evil.example/checkout/v1/redirect',
    'https://www.mercadopago.com.ar@evil.example/checkout/v1/redirect',
    'https://user@www.mercadopago.com.ar/checkout/v1/redirect',
    'https://www.mercadopago.com.ar:8443/checkout/v1/redirect',
    'https://www.mercadopago.com.ar/developers',
    'javascript:alert(1)',
    '/checkout/v1/redirect',
  ]) {
    assert.equal(isMercadoPagoCheckoutUrl(url), false, url)
    assert.equal(
      mobilePaymentResultSchema.safeParse({ paymentId, amount: 10, status: 'pending', checkoutUrl: url }).success,
      false,
    )
  }
  assert.equal(
    mobilePaymentResultSchema.parse({ paymentId, amount: 10, status: 'pending', checkoutUrl: valid }).checkoutUrl,
    valid,
  )
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  acceptsPaymentMethod,
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

import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  acceptsPaymentMethod,
  enabledPaymentMethods,
  paymentMethodDescriptions,
  paymentMethodLabels,
  paymentMethods,
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

import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  checkoutAttemptKey,
  clearCheckoutAttempt,
  readCheckoutAttempt,
  saveCheckoutAttempt,
  type CheckoutAttempt,
} from '../src/features/checkout-attempt'

const sessionId = '00000000-0000-4000-8000-000000000001'
const participantId = '00000000-0000-4000-8000-000000000002'
const paymentId = '00000000-0000-4000-8000-000000000003'
const attempt: CheckoutAttempt = {
  request: { action: 'create', sessionId, requestId: '00000000-0000-4000-8000-000000000004', mode: 'full' },
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

test('checkout preserves the exact request across reload and scopes it to session and diner', () => {
  const storage = memoryStorage()
  saveCheckoutAttempt(participantId, attempt, storage)
  assert.deepEqual(readCheckoutAttempt(sessionId, participantId, storage), attempt)
  saveCheckoutAttempt(participantId, { ...attempt, paymentId }, storage)
  assert.deepEqual(readCheckoutAttempt(sessionId, participantId, storage), { ...attempt, paymentId })
  assert.equal(readCheckoutAttempt(sessionId, 'another-diner', storage), undefined)
  assert.equal(readCheckoutAttempt('another-session', participantId, storage), undefined)
  clearCheckoutAttempt(sessionId, participantId, storage)
  assert.equal(readCheckoutAttempt(sessionId, participantId, storage), undefined)
})

test('corrupted storage and injected create fields never become a new request', () => {
  const storage = memoryStorage()
  const key = checkoutAttemptKey(sessionId, participantId)
  for (const value of [
    '{',
    'null',
    JSON.stringify({ ...attempt, paymentId: 'bad' }),
    JSON.stringify({ request: { ...attempt.request, amount: 1 } }),
    JSON.stringify({ request: { ...attempt.request, sessionId: paymentId } }),
  ]) {
    storage.setItem(key, value)
    assert.equal(readCheckoutAttempt(sessionId, participantId, storage), undefined)
  }
  assert.throws(
    () =>
      saveCheckoutAttempt(participantId, attempt, {
        ...storage,
        setItem: () => {
          throw new Error('Storage denied')
        },
      }),
    /almacenamiento/,
  )
})

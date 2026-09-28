import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appErrorMessage, appErrors, fromPostgres, isRetryableError } from '../src/errors.ts'

test('one translator for the three shapes a Postgres error arrives in', () => {
  assert.equal(fromPostgres('FORBIDDEN').code, 'FORBIDDEN')
  assert.equal(fromPostgres({ message: 'P0001: INVALID_TRANSITION' }).code, 'INVALID_TRANSITION')
  assert.equal(fromPostgres('TABLE_OCCUPIED').code, 'TABLE_OCCUPIED')
  const constraint = fromPostgres('duplicate key violates "tables_label_unique_per_branch"')
  assert.equal(constraint.code, 'TABLE_LABEL_TAKEN')
  assert.equal(constraint.message, appErrors.TABLE_LABEL_TAKEN.message)
})

test('an unknown failure never leaks the internal detail, and says which operation failed if the caller knows', () => {
  const unknown = fromPostgres('relation "x" does not exist')
  assert.equal(unknown.code, 'SERVER_ERROR')
  assert.equal(unknown.message, appErrors.SERVER_ERROR.message)
  assert.equal(unknown.detail, 'relation "x" does not exist')
  assert.equal(unknown.status, 503)
  assert.equal(unknown.retryable, true)
  // Quien sabe qué operación falló lo dice; un código conocido conserva su mensaje.
  const read = fromPostgres('fetch failed', 'No pudimos actualizar la cuenta.')
  assert.equal(read.code, 'SERVER_ERROR')
  assert.equal(read.message, 'No pudimos actualizar la cuenta.')
  assert.equal(read.detail, 'fetch failed')
  assert.equal(fromPostgres('FORBIDDEN', 'No pudimos actualizar la cuenta.').message, appErrors.FORBIDDEN.message)
})

test('the error catalog decides which failures keep a submission for retry', () => {
  // Rechazos definitivos: liberan el envío para que el comensal revise el carrito.
  for (const code of ['PRICE_CHANGED', 'SESSION_CLOSED', 'IDEMPOTENCY_CONFLICT', 'REQUEST_ABANDONED',
    'PAYMENT_METHOD_DISABLED']) {
    assert.equal(isRetryableError(code), false, code)
  }
  // Fallas transitorias y códigos desconocidos (red caída): el envío se conserva.
  for (const code of ['POS_UNAVAILABLE', 'SERVER_ERROR', 'AUTH_REQUIRED', 'CONNECTION_ERROR']) {
    assert.equal(isRetryableError(code), true, code)
  }
  assert.equal(appErrorMessage('STALE_DATA', 'fallback'), appErrors.STALE_DATA.message)
  assert.equal(appErrorMessage('P0001: INVALID_TRANSITION', 'fallback'), 'fallback')
})

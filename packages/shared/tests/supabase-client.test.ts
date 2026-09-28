import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { AppError, appErrors } from '../src/errors.ts'
import { unwrap } from '../src/supabase-client.ts'

/** Lo único que `unwrap` lee de una respuesta de PostgREST: el dato o el error. */
const success = <T>(data: T) => ({ data, error: null }) as PostgrestSingleResponse<T>
const failure = (message: string) => ({ data: null, error: { message } }) as unknown as PostgrestSingleResponse<never>

function thrown(run: () => unknown): AppError {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof AppError)
    return error
  }
  assert.fail('unwrap tenía que tirar')
}

test('unwrap hands over the data of a successful response', () => {
  assert.deepEqual(unwrap(success([{ id: 'a' }])), [{ id: 'a' }])
  assert.equal(unwrap(success(null)), null)
})

test('a catalog rejection keeps its own message even when the caller names the operation', () => {
  const error = thrown(() => unwrap(failure('P0001: SESSION_CLOSED'), 'No pudimos actualizar la cuenta.'))
  assert.equal(error.code, 'SESSION_CLOSED')
  assert.equal(error.message, appErrors.SESSION_CLOSED.message)
})

test('an unknown failure says which operation failed, and keeps the raw text out of the message', () => {
  const named = thrown(() => unwrap(failure('TypeError: Failed to fetch'), 'No pudimos actualizar la cuenta.'))
  assert.equal(named.code, 'SERVER_ERROR')
  assert.equal(named.message, 'No pudimos actualizar la cuenta.')
  assert.equal(named.detail, 'TypeError: Failed to fetch')

  const generic = thrown(() => unwrap(failure('TypeError: Failed to fetch')))
  assert.equal(generic.message, appErrors.SERVER_ERROR.message)
})

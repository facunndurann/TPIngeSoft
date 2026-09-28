import { beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { AppError } from '@restaurant-platform/shared'

/** Lo que responde cada tabla, con la forma de PostgREST: el dato o el error. */
const responses = vi.hoisted(() => new Map<string, { data: unknown; error: { message: string } | null }>())

// La cadena de PostgREST que usa loadTable, con sus dos finales: `maybeSingle`
// devuelve null si no hay fila; `single`, un error, como el cliente real.
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => responses.get(table),
        single: async () => {
          const response = responses.get(table)!
          if (response.error || response.data !== null) return response
          return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
        },
      }
      return query
    },
  },
}))

const { loadTable } = await import('../src/features/menu-api')

const found = (data: unknown) => ({ data, error: null })

beforeEach(() => {
  responses.set('tables', found({ id: 't', branch_id: 'b', restaurant_id: 'r', label: 'Mesa 1' }))
  responses.set('branches', found({ id: 'b', name: 'Centro' }))
  responses.set('restaurants', found({ id: 'r', name: 'La Esquina' }))
})

async function rejection(): Promise<AppError> {
  try {
    await loadTable('qr')
  } catch (error) {
    assert.ok(error instanceof AppError)
    return error
  }
  assert.fail('loadTable tenía que rechazar')
}

test('the QR table comes with its branch and restaurant', async () => {
  const { table, branch, restaurant } = await loadTable('qr')
  assert.deepEqual([table.label, branch.name, restaurant.name], ['Mesa 1', 'Centro', 'La Esquina'])
})

test('a branch that is not serving is a table that does not take orders: retrying will not change it', async () => {
  responses.set('branches', found(null))
  const error = await rejection()
  assert.equal(error.code, 'TABLE_UNAVAILABLE')
  assert.equal(error.retryable, false)
})

test('a failed read is not passed off as a closed branch: it can be retried', async () => {
  responses.set('restaurants', { data: null, error: { message: 'TypeError: Failed to fetch' } })
  const error = await rejection()
  assert.equal(error.code, 'SERVER_ERROR')
  assert.equal(error.retryable, true)
})

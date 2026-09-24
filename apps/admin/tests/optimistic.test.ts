import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { MutationObserver, QueryClient, queryOptions } from '@tanstack/react-query'
import { optimistic, patchRow } from '../src/lib/optimistic'

type Row = { id: string; active: boolean }
type Change = { id: string; active: boolean }

const rows = queryOptions({ queryKey: ['rows'], queryFn: async (): Promise<Row[]> => [] })

/** Una escritura que no termina hasta que el test decide si sale bien o mal. */
function pending() {
  let settle!: (ok: boolean) => void
  const done = new Promise<void>((resolve, reject) => {
    settle = (ok) => (ok ? resolve() : reject(new Error('boom')))
  })
  return { done, settle }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  client.setQueryData(rows.queryKey, [
    { id: 'a', active: true },
    { id: 'b', active: true },
  ])
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  const mutate = (change: Change, write: Promise<void>) =>
    new MutationObserver(client, {
      mutationFn: () => write,
      ...optimistic(client, rows.queryKey, patchRow<Row>),
    })
      .mutate(change)
      .catch(() => undefined)
  const active = (id: string) => client.getQueryData(rows.queryKey)?.find((row) => row.id === id)?.active
  return { client, invalidate, mutate, active }
}

test('patchRow cambia solo la fila pedida', () => {
  const list = [{ id: 'a', active: true }, { id: 'b', active: true }]
  assert.deepEqual(patchRow(list, { id: 'b', active: false }), [{ id: 'a', active: true }, { id: 'b', active: false }])
})

test('el cambio se ve antes de que responda el servidor, y si falla vuelve lo anterior', async () => {
  const { mutate, active, invalidate } = setup()
  const write = pending()
  const done = mutate({ id: 'a', active: false }, write.done)
  await vi.waitFor(() => assert.equal(active('a'), false))
  write.settle(false)
  await done
  assert.equal(active('a'), true)
  // Haya salido bien o mal, al terminar se relee la lista.
  assert.equal(invalidate.mock.calls.length, 1)
})

test('con dos escrituras en vuelo sobre la misma lista, solo relee la última en terminar', async () => {
  const { mutate, active, invalidate } = setup()
  const first = pending()
  const second = pending()
  const a = mutate({ id: 'a', active: false }, first.done)
  const b = mutate({ id: 'b', active: false }, second.done)
  await vi.waitFor(() => assert.equal(active('b'), false))

  first.settle(true)
  await a
  // Releer ahora traería «b» todavía activa y pisaría su cambio optimista.
  assert.equal(invalidate.mock.calls.length, 0)
  assert.equal(active('b'), false)

  second.settle(true)
  await b
  assert.equal(invalidate.mock.calls.length, 1)
})

import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { MutationObserver } from '@tanstack/react-query'
import { createPosQueryClient } from './lib/query-client'

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

/** Un cliente del POS que anota cada relectura en `log` y la deja colgada hasta `finishRefresh`. */
function clientWithSlowRefresh(log: string[]) {
  const client = createPosQueryClient()
  cleanups.push(() => client.clear())
  let finishRefresh = () => {}
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    log.push(`refresh ${JSON.stringify(filters?.queryKey)}`)
    return new Promise<void>((resolve) => { finishRefresh = resolve })
  })
  return { client, finishRefresh: () => finishRefresh() }
}

test('a successful write rereads the POS before its own onSuccess, and stays pending meanwhile', async () => {
  const log: string[] = []
  const { client, finishRefresh } = clientWithSlowRefresh(log)
  const observer = new MutationObserver(client, {
    mutationFn: async () => 'saved',
    onSuccess: () => { log.push('own onSuccess') },
  })

  const done = observer.mutate()
  await vi.waitFor(() => assert.deepEqual(log, ['refresh ["pos"]']))
  // Mientras se relee, la mutación sigue en curso: el botón no se libera antes.
  assert.equal(observer.getCurrentResult().isPending, true)

  finishRefresh()
  await done
  assert.deepEqual(log, ['refresh ["pos"]', 'own onSuccess'])
  assert.equal(observer.getCurrentResult().isSuccess, true)
})

test('a failed write does not reread anything', async () => {
  const log: string[] = []
  const { client } = clientWithSlowRefresh(log)
  const observer = new MutationObserver(client, {
    mutationFn: async () => { throw new Error('No se pudo') },
  })

  await observer.mutate().catch(() => {})
  assert.deepEqual(log, [])
})

import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { AppSupabaseClient } from '@restaurant-platform/shared'
import { REALTIME_RETRY_MS, subscribeToChanges } from '@restaurant-platform/ui'

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
type Binding = { event: string; schema: string; table: string; filter?: string }

/** Un canal de realtime-js con lo que usa el suscriptor: bindings, estado y cambios. */
class FakeChannel {
  readonly bindings: Binding[] = []
  private readonly callbacks: (() => void)[] = []
  private onStatus?: (status: Status) => void
  removed = false
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  on(_type: 'postgres_changes', binding: Binding, callback: () => void) {
    this.bindings.push(binding)
    this.callbacks.push(callback)
    return this
  }

  subscribe(callback: (status: Status) => void) {
    this.onStatus = callback
    return this
  }

  emit(status: Status) {
    this.onStatus?.(status)
  }

  /** Un cambio en la tabla de un binding: su callback, y solo ese. */
  change(binding = 0) {
    this.callbacks[binding]()
  }
}

/**
 * El cliente con las dos reglas de realtime-js que importan acá: un nombre que ya
 * existe devuelve el mismo canal, y soltar un canal le dispara su propio CLOSED
 * (Phoenix hace `trigger(close)` al salir).
 */
function fakeClient() {
  const channels: FakeChannel[] = []
  const client = {
    channel(name: string) {
      const existing = channels.find((channel) => channel.name === name && !channel.removed)
      if (existing) return existing
      const created = new FakeChannel(name)
      channels.push(created)
      return created
    },
    async removeChannel(channel: FakeChannel) {
      channel.removed = true
      channel.emit('CLOSED')
      return 'ok'
    },
  }
  return { channels, client: client as unknown as AppSupabaseClient }
}

let changes = 0
const onChange = () => { changes += 1 }

beforeEach(() => {
  vi.useFakeTimers()
  changes = 0
})
afterEach(() => {
  vi.useRealTimers()
})

test('one channel with every listener, and a fresh read when it connects', () => {
  const { channels, client } = fakeClient()
  subscribeToChanges(client, 'pos-r', [
    { table: 'orders', filter: 'restaurant_id=eq.r' },
    { table: 'table_sessions', event: 'UPDATE' },
  ], onChange)

  assert.equal(channels.length, 1)
  assert.equal(channels[0].name, 'pos-r')
  assert.deepEqual(channels[0].bindings, [
    { event: '*', schema: 'public', table: 'orders', filter: 'restaurant_id=eq.r' },
    { event: 'UPDATE', schema: 'public', table: 'table_sessions' },
  ])

  channels[0].emit('SUBSCRIBED')
  channels[0].change(0)
  channels[0].change(1)
  assert.equal(changes, 3, 'La conexión y cada tabla escuchada avisan')
})

test('a dropped channel comes back after the wait, under the same name, and catches up', async () => {
  const { channels, client } = fakeClient()
  subscribeToChanges(client, 'pos-r', [{ table: 'orders' }], onChange)
  channels[0].emit('SUBSCRIBED')

  channels[0].emit('CHANNEL_ERROR')
  await vi.advanceTimersByTimeAsync(REALTIME_RETRY_MS[0] - 1)
  assert.equal(channels.length, 1, 'Espera antes de reintentar')

  await vi.advanceTimersByTimeAsync(1)
  assert.equal(channels.length, 2)
  assert.equal(channels[0].removed, true)
  assert.equal(channels[1].name, 'pos-r')

  channels[1].emit('SUBSCRIBED')
  assert.equal(changes, 2, 'Lo que pasó sin línea se recupera con una lectura')
})

test('releasing the old channel does not set off another reconnection', async () => {
  const { channels, client } = fakeClient()
  subscribeToChanges(client, 'pos-r', [{ table: 'orders' }], onChange)
  channels[0].emit('SUBSCRIBED')
  channels[0].emit('TIMED_OUT')
  await vi.advanceTimersByTimeAsync(REALTIME_RETRY_MS[0])
  channels[1].emit('SUBSCRIBED')

  // Media hora con el canal sano: nadie lo tira abajo.
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  assert.equal(channels.length, 2)
  assert.equal(channels[1].removed, false)
  assert.equal(changes, 2)
})

test('failures in a row wait longer each time, and a success resets the wait', async () => {
  const { channels, client } = fakeClient()
  subscribeToChanges(client, 'pos-r', [{ table: 'orders' }], onChange)

  for (const [index, wait] of REALTIME_RETRY_MS.slice(0, 3).entries()) {
    channels[index].emit('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(wait - 1)
    assert.equal(channels.length, index + 1, `Todavía espera ${wait} ms`)
    await vi.advanceTimersByTimeAsync(1)
    assert.equal(channels.length, index + 2)
  }

  channels[3].emit('SUBSCRIBED')
  channels[3].emit('CLOSED')
  await vi.advanceTimersByTimeAsync(REALTIME_RETRY_MS[0])
  assert.equal(channels.length, 5, 'Después de conectar, vuelve a la espera más corta')
})

test('unsubscribing stops the retries, releases the channel and ignores late notices', async () => {
  const { channels, client } = fakeClient()
  const unsubscribe = subscribeToChanges(client, 'pos-r', [{ table: 'orders' }], onChange)
  channels[0].emit('CHANNEL_ERROR')

  unsubscribe()
  await vi.advanceTimersByTimeAsync(60_000)
  assert.equal(channels.length, 1)
  assert.equal(channels[0].removed, true)

  channels[0].emit('SUBSCRIBED')
  assert.equal(changes, 0)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { groupOrdersByColumn, posColumnFor } from '../src/pos.ts'
import { localDateKey } from '../src/time.ts'

test('POS board groups kitchen columns, FIFO in prep/ready, and newest first otherwise', () => {
  const orders = [
    { id: 'd', status: 'delivered', created_at: '2026-09-05T12:00:00.000Z' },
    { id: 'n2', status: 'accepted', created_at: '2026-09-05T12:05:00.000Z' },
    { id: 'p-old', status: 'in_preparation', created_at: '2026-09-05T11:00:00.000Z' },
    { id: 'p-new', status: 'in_preparation', created_at: '2026-09-05T11:30:00.000Z' },
    { id: 'n1', status: 'submitted', created_at: '2026-09-05T12:01:00.000Z' },
    { id: 'r', status: 'ready', created_at: '2026-09-05T10:00:00.000Z' },
    { id: 'c', status: 'cancelled', created_at: '2026-09-05T12:00:00.000Z' },
  ] as const
  const grouped = groupOrdersByColumn([...orders])
  assert.deepEqual(grouped.new.map((order) => order.id), ['n2', 'n1'])
  assert.deepEqual(grouped.in_preparation.map((order) => order.id), ['p-old', 'p-new'])
  assert.deepEqual(grouped.ready.map((order) => order.id), ['r'])
  assert.deepEqual(grouped.delivered.map((order) => order.id), ['d'])
  assert.equal(posColumnFor('cancelled'), null)
})

test('the restaurant day changes at Argentina midnight, matching orders.local_date', () => {
  // 03:00 UTC es medianoche en Buenos Aires (UTC-3); pos.sql verifica el mismo borde en Postgres.
  assert.equal(localDateKey(new Date('2026-09-06T02:59:59.000Z')), '2026-09-05')
  assert.equal(localDateKey(new Date('2026-09-06T03:00:00.000Z')), '2026-09-06')
})

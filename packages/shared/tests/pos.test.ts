import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { OrderStatus } from '../src/orders.ts'
import {
  getPosTableState,
  groupOrdersByColumn,
  isKitchenTicket,
  kitchenTicketStatuses,
  posActions,
  posColumnFor,
  type PosTableStateSession,
} from '../src/pos.ts'

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

// El tablero pide a la base estos estados; entregados y cancelados quedan afuera.
test('kitchen tickets are the statuses that can still advance', () => {
  assert.deepEqual(kitchenTicketStatuses, ['submitted', 'accepted', 'in_preparation', 'ready'])
})

test('POS actions advance and cancel until delivery, and nothing leaves cancelled', () => {
  assert.equal(posActions.accepted.advance?.to, 'in_preparation')
  assert.equal(posActions.ready.cancel?.to, 'cancelled')
  assert.equal(posActions.delivered.advance, undefined)
  assert.equal(posActions.delivered.cancel, undefined)
  assert.deepEqual(posActions.cancelled, {})
  assert.equal(isKitchenTicket('ready'), true)
  assert.equal(isKitchenTicket('delivered'), false)
  assert.equal(isKitchenTicket('cancelled'), false)
})

test('reverting steps back exactly one stage, never to submitted nor from cancelled', () => {
  // Que estos pares coincidan con la tabla order_status_transitions lo verifica
  // supabase/tests/orders.integration.mjs contra la base.
  assert.deepEqual(
    Object.entries(posActions).flatMap(([from, { revert }]) => (revert ? [`${from} -> ${revert.to}`] : [])),
    ['in_preparation -> accepted', 'ready -> in_preparation', 'delivered -> ready'],
  )
})

test('table map states follow operational priority without inventing occupancy', () => {
  // Una fila de pos_open_sessions sin comandas de cocina ni pagos por confirmar.
  // Entregados y cancelados no son comandas de cocina: la vista ya no los trae.
  const seated: PosTableStateSession = { kitchen_statuses: [], has_pending_payment: false }
  const kitchen = (...kitchen_statuses: OrderStatus[]) => ({ ...seated, kitchen_statuses })
  assert.equal(getPosTableState(null), 'free')
  assert.equal(getPosTableState({ ...seated, bill_requested_at: '2026-09-18' }), 'bill_requested')
  assert.equal(getPosTableState(seated), 'occupied')
  assert.equal(getPosTableState(kitchen('accepted')), 'order_pending')
  assert.equal(getPosTableState(kitchen('in_preparation')), 'in_preparation')
  assert.equal(getPosTableState(kitchen('submitted', 'ready')), 'ready')
  assert.equal(getPosTableState({
    ...kitchen('ready'),
    bill_requested_at: '2026-09-18T12:00:00Z',
  }), 'bill_requested')
  assert.equal(getPosTableState({
    ...seated,
    bill_requested_at: '2026-09-18T12:00:00Z',
    has_pending_payment: true,
  }), 'payment_pending')
  // Llamar al mozo para que cobre manda a alguien a la mesa; un pago electrónico
  // a medio confirmar, no. Por eso son dos estados y ese va primero.
  assert.equal(getPosTableState({
    ...kitchen('ready'),
    in_person_payment_requested_at: '2026-09-18T12:00:00Z',
    has_pending_payment: true,
  }), 'in_person_payment')
})

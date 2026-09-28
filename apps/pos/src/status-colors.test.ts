import { test } from 'vitest'
import assert from 'node:assert/strict'
import { getPosTableState, type OrderStatus, posColumnFor } from '@restaurant-platform/shared'
import { boardColumnStyles, orderStatusTone, tableStateStyles } from './features/pos/status-colors'

/** Una mesa abierta sin llamados ni pagos, con un solo pedido en `status`. */
const tableWith = (status: OrderStatus) =>
  getPosTableState({
    kitchen_statuses: [status],
    in_person_payment_requested_at: null,
    has_pending_payment: false,
    bill_requested_at: null,
  } as Parameters<typeof getPosTableState>[0])

test('an order in progress reads in one color on its ticket, its board column and its table on the map', () => {
  for (const status of ['submitted', 'accepted', 'in_preparation', 'ready'] as const) {
    // El estado que el pedido le da a su mesa lo decide getPosTableState, no una copia.
    const tone = tableStateStyles[tableWith(status)].tone
    assert.equal(orderStatusTone[status], tone, status)
    assert.match(boardColumnStyles[posColumnFor(status)!], new RegExp(`\\bbg-${tone}-50\\b`), status)
  }
})

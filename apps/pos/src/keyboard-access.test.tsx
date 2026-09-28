import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { localDateKey } from '@restaurant-platform/shared'
import { ControlSizeProvider } from '@restaurant-platform/ui'
import { AccessContext, type PosContext } from './context/pos-context'
import { ActiveTables } from './features/pos/ActiveTables'
import { FloorMap } from './features/pos/FloorMap'
import { OrderHistory } from './features/pos/OrderHistory'
import {
  posFloorSectionsQuery,
  posHistoryQuery,
  posOpenSessionsQuery,
  posTablesQuery,
} from './features/pos/queries'
import { createPosQueryClient } from './lib/query-client'

const cashier: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'floor.read', 'history.read', 'sessions.close'],
}
const [r, b] = [cashier.restaurant_id, cashier.branch_id]

const table = {
  id: 'table-1', label: 'Mesa 1', section_id: 'section-1', seats: 4, shape: 'square',
  position_x: 0, position_y: 0, width: 1, height: 1, is_active: true, is_visible: true,
  floor_sections: { id: 'section-1', name: 'Salón', sort_order: 0, is_active: true },
}
const session = {
  id: 'session-1', table_id: 'table-1', table_label: 'Mesa 1', participant_names: [],
  opened_at: new Date().toISOString(), kitchen_tickets: 0, kitchen_statuses: [], has_pending_payment: false,
  submitted_amount: null, total_amount: null, paid_amount: null, pending_amount: null,
  assigned_employee_name: null, bill_requested_at: null, bill_attended_at: null,
  in_person_payment_requested_at: null, in_person_payment_attended_at: null,
}
const order = {
  id: 'order-1', status: 'delivered', total_amount: 20, notes: null, submitted_by: null,
  created_at: new Date().toISOString(), order_items: [],
  table_sessions: { status: 'open', session_participants: [], tables: { label: 'Mesa 1' } },
}

/** La pantalla con sus datos ya en la caché, como la ve el POS: táctil y con permisos de caja. */
function render(screen: ReactNode) {
  const client = createPosQueryClient()
  client.setQueryData(posTablesQuery(r, b).queryKey, [table] as never)
  client.setQueryData(posOpenSessionsQuery(r, b).queryKey, [session] as never)
  client.setQueryData(posFloorSectionsQuery(r, b).queryKey, [
    { id: 'section-1', name: 'Salón', sort_order: 0, is_active: true },
    { id: 'section-2', name: 'Terraza', sort_order: 1, is_active: true },
  ])
  client.setQueryData(posHistoryQuery(r, b, localDateKey()).queryKey, [order] as never)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ControlSizeProvider size="touch">
        <AccessContext value={cashier}>
          <MemoryRouter>{screen}</MemoryRouter>
        </AccessContext>
      </ControlSizeProvider>
    </QueryClientProvider>,
  )
}

test('each history row has a button to open it, named after the table and the time', () => {
  const html = render(<OrderHistory />)
  assert.match(html, /<tr[^>]*>(?:(?!<\/tr>).)*<button type="button" aria-haspopup="dialog"[^>]*>Mesa 1<span class="sr-only">, pedido de las /)
})

test('"Continuar comanda" is a touch-sized link with no button nested inside', () => {
  const html = render(<ActiveTables />)
  assert.match(html, /<a class="[^"]*\bmin-h-11\b[^"]*" href="\/salon\/table-1"[^>]*>Continuar comanda<\/a>/)
  assert.doesNotMatch(html, /<a\b(?:(?!<\/a>).)*<button/)
})

test('sectors are pressed/unpressed buttons in a group, not tabs without their keyboard contract', () => {
  const html = render(<FloorMap />)
  assert.doesNotMatch(html, /role="tab/)
  assert.match(html, /role="group" aria-label="Sectores del salón"/)
  assert.match(html, /aria-pressed="true"[^>]*>(?:<svg(?:(?!<\/svg>).)*<\/svg>)?Salón</)
  assert.match(html, /aria-pressed="false"[^>]*>Terraza</)
})

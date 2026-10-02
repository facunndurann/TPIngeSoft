// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { Route } from 'react-router'
import type { QueryClient } from '@tanstack/react-query'
import {
  billQuery,
  type loadBill,
  type loadOrders,
  type loadPayments,
  mobilePaymentAvailabilityQuery,
  ordersQuery,
  paymentsQuery,
} from '../src/features/orders-api'
import { billPath, ordersPath } from '../src/features/table-paths'
import { TableBillPage, TableOrdersPage } from '../src/pages/TablePage'
import { ana, cleanupTables, renderTable, sessionId, token } from './table-harness'

// Sin red: todo lo que las pantallas leen está sembrado en la caché.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(cleanupTables)

/** Ana pidió una milanesa de $9.000, ya en cuenta, y pagó $2.000 en la mesa. */
const order: Awaited<ReturnType<typeof loadOrders>>[number] = {
  id: 'order-1',
  session_id: sessionId,
  restaurant_id: 'restaurant-1',
  status: 'accepted',
  submitted_by: ana.id,
  total_amount: 9000,
  created_at: '2026-09-22T20:10:00Z',
  accepted_at: '2026-09-22T20:10:00Z',
  preparing_at: null,
  ready_at: null,
  delivered_at: null,
  cancelled_at: null,
  local_date: null,
  notes: null,
  request_id: null,
  request_payload: null,
  order_items: [
    {
      id: 'item-1',
      order_id: 'order-1',
      product_id: 'p',
      product_name: 'Milanesa',
      quantity: 1,
      base_price: 9000,
      total_price: 9000,
      participant_id: ana.id,
      is_shared: false,
      notes: null,
      order_item_modifiers: [],
      order_item_removed_ingredients: [],
    },
  ],
}

const bill: Awaited<ReturnType<typeof loadBill>> = {
  session_id: sessionId,
  restaurant_id: 'restaurant-1',
  total_amount: 9000,
  submitted_amount: 0,
  paid_amount: 2000,
  pending_amount: 7000,
  is_settled: false,
}

const payment: Awaited<ReturnType<typeof loadPayments>>[number] = {
  id: 'payment-1',
  participant_id: ana.id,
  amount: 2000,
  refunded_amount: 0,
  provider_status: null,
  mode: 'full',
  method: 'in_person',
  status: 'approved',
  external_reference: null,
  created_at: '2026-09-22T20:30:00Z',
  payment_order_items: [],
}

function seed(client: QueryClient) {
  client.setQueryData(ordersQuery(sessionId).queryKey, [order])
  client.setQueryData(billQuery(sessionId).queryKey, bill)
  client.setQueryData(paymentsQuery(sessionId).queryKey, [payment])
  client.setQueryData(mobilePaymentAvailabilityQuery(sessionId).queryKey, true)
}

/** Cada bloque de la cuenta, por la etiqueta de su sección o el texto de su botón. */
const billBlocks: Record<string, string> = {
  'Resumen de cuenta': 'falta pagar',
  'División de la cuenta': 'división',
  'Agregar invitado a la cuenta': 'invitados',
  'Pago electrónico': 'pagar',
  'Historial de pagos': 'pagos',
  'Atención en tu mesa': 'mozo',
}

/** Los bloques de la cuenta que hay en pantalla, en el orden en que se leen. */
function blocksIn(container: HTMLElement) {
  return [...container.querySelectorAll('[aria-label], button')]
    .map((element) => billBlocks[element.getAttribute('aria-label') ?? element.textContent ?? ''])
    .filter(Boolean)
}

test('the bill tab reads in the order decisions are made, with paying as its only primary action', async () => {
  const container = await renderTable(billPath(token), <Route path="cuenta" element={<TableBillPage />} />, {
    paymentMethods: ['mobile', 'in_person', 'external'],
    seed,
  })

  // El pago lee la división: nunca aparece antes que ella.
  assert.deepEqual(blocksIn(container), ['falta pagar', 'división', 'invitados', 'pagar', 'pagos', 'mozo'])

  // Con pago desde el celular, llamar al mozo es la alternativa y no compite con pagar.
  const primaries = [...container.querySelectorAll('button.primary')].map((button) => button.textContent)
  assert.equal(primaries.length, 1)
  assert.match(primaries[0] ?? '', /^Pagar /)
  assert.doesNotMatch(container.textContent ?? '', /debajo/)
  assert.doesNotMatch(container.textContent ?? '', /servidor/)
  // El historial de pagos es una lista con la hora de mesa, no la fecha completa.
  assert.equal(container.querySelectorAll('.payment-list .payment-line').length, 1)
  assert.match(container.querySelector('.payment-line time')?.textContent ?? '', /^(\d{1,2}\/\d{1,2} )?\d{2}:\d{2}$/)
})

test('without mobile payment, calling the waiter is the primary action of the bill', async () => {
  const container = await renderTable(billPath(token), <Route path="cuenta" element={<TableBillPage />} />, { seed })

  assert.deepEqual(blocksIn(container), ['falta pagar', 'división', 'invitados', 'pagos', 'mozo'])
  const primaries = [...container.querySelectorAll('button.primary')].map((button) => button.textContent)
  assert.deepEqual(primaries, ['Llamar mozo'])
})

test('an enabled mobile method is not offered when the branch has no effective provider', async () => {
  const unavailable = (client: QueryClient) => {
    seed(client)
    client.setQueryData(mobilePaymentAvailabilityQuery(sessionId).queryKey, false)
  }
  const container = await renderTable(billPath(token), <Route path="cuenta" element={<TableBillPage />} />, {
    paymentMethods: ['mobile', 'in_person'],
    seed: unavailable,
  })

  assert.deepEqual(blocksIn(container), ['falta pagar', 'división', 'invitados', 'pagos', 'mozo'])
  assert.match(container.textContent ?? '', /pago desde el celular no está disponible/i)
})

test('the orders tab lists what was ordered and nothing of the bill', async () => {
  const container = await renderTable(ordersPath(token), <Route path="pedidos" element={<TableOrdersPage />} />, {
    seed,
  })

  assert.match(container.textContent ?? '', /Pedido 1/)
  assert.ok([...container.querySelectorAll('button')].some((button) => button.textContent === 'Pedir de nuevo'))
  assert.deepEqual(blocksIn(container), [])
})

test('payment history distinguishes a partial refund from the amount credited to the bill', async () => {
  const container = await renderTable(billPath(token), <Route path="cuenta" element={<TableBillPage />} />, {
    seed: (client) => {
      seed(client)
      client.setQueryData(paymentsQuery(sessionId).queryKey, [{ ...payment, refunded_amount: 500 }])
    },
  })
  const history = container.querySelector('.payment-line')?.textContent ?? ''
  assert.match(history, /Reintegrado:.*500/)
  assert.match(history, /Acreditado:.*1[.,]500/)
})

// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MercadoPagoPayments } from '../src/features/MercadoPagoPayments'
import { mobilePaymentsQuery, type loadMobilePayments } from '../src/queries/mobile-payments'

vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

test('payment monitoring shows net credit and loads flagged payments separately from recent payments', async () => {
  const restaurantId = 'restaurant-1'
  const payment: Awaited<ReturnType<typeof loadMobilePayments>>[number] = {
    id: 'payment-1',
    session_id: 'session-1',
    amount: 2000,
    refunded_amount: 500,
    status: 'approved',
    provider_status: 'approved',
    mp_payment_id: '123456',
    reconciliation_issue: null,
    created_at: '2026-10-02T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
  }
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(mobilePaymentsQuery(restaurantId).queryKey, [payment])
  client.setQueryData(mobilePaymentsQuery(restaurantId, true).queryKey, [
    {
      ...payment,
      id: 'older-payment',
      status: 'cancelled',
      provider_status: 'charged_back',
      reconciliation_issue: 'CHARGEBACK_REVIEW',
      refunded_amount: 0,
    },
  ])
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MercadoPagoPayments restaurantId={restaurantId} />
      </QueryClientProvider>,
    ),
  )
  assert.match(container.textContent ?? '', /Acreditado a la cuenta:.*1[.,]500/)
  assert.match(container.textContent ?? '', /Reintegrado:.*500/)
  assert.match(container.textContent ?? '', /123456/)
  assert.doesNotMatch(container.textContent ?? '', /Se detectó|contracargo/)

  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  assert.match(container.textContent ?? '', /older-payment/)
  assert.match(container.textContent ?? '', /Requiere revisión/)
  assert.match(container.textContent ?? '', /Mercado Pago informó un contracargo/)
  assert.match(container.textContent ?? '', /Acreditado a la cuenta:.*0/)
  assert.doesNotMatch(container.textContent ?? '', /Acreditado a la cuenta:.*2[.,]000/)
})

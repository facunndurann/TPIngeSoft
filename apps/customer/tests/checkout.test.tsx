// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppError,
  defaultSessionSplit,
  type MobilePaymentRequest,
  type MobilePaymentResult,
} from '@restaurant-platform/shared'
import { MobilePayment } from '../src/features/MobilePayment'
import { readCheckoutAttempt, saveCheckoutAttempt } from '../src/features/checkout-attempt'
import type { PaymentPlanInput } from '../src/features/mobile-payment'

const { runPayment, refreshTable } = vi.hoisted(() => ({ runPayment: vi.fn(), refreshTable: vi.fn(async () => {}) }))
vi.mock('../src/features/orders-api', () => ({ runMobilePayment: runPayment }))
vi.mock('../src/features/table-context', () => ({ useTable: () => ({ refreshTable, nameOf: () => 'Ana' }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const sessionId = '00000000-0000-4000-8000-000000000001'
const participantId = '00000000-0000-4000-8000-000000000002'
const paymentId = '00000000-0000-4000-8000-000000000003'
const checkoutUrl = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc'
const account: Omit<PaymentPlanInput, 'selected'> = {
  participantId,
  participants: [],
  split: defaultSessionSplit,
  pending: 100,
  accountTotal: 100,
  closed: false,
  orders: [],
  payments: [],
}
const pending = {
  id: paymentId,
  participant_id: participantId,
  amount: 100,
  method: 'mobile',
  mode: 'full',
  status: 'pending',
  payment_order_items: [],
} as const
const response: MobilePaymentResult = { paymentId, amount: 100, status: 'pending', checkoutUrl }
const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  window.sessionStorage.clear()
  vi.restoreAllMocks()
  runPayment.mockReset()
  refreshTable.mockClear()
})

async function settle() {
  for (let round = 0; round < 4; round++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
}

async function renderPayment(payments = account.payments) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    act(() => root.unmount())
    client.clear()
    container.remove()
    mounted = false
  }
  cleanups.push(unmount)
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MobilePayment {...account} payments={payments} sessionId={sessionId} />
      </QueryClientProvider>,
    ),
  )
  await settle()
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(label))
    assert.ok(button, `Missing button: ${label}`)
    await act(async () => button.click())
    await settle()
  }
  return { container, click, unmount }
}

test('returning with a forged success query still asks the backend about the ledger payment', async () => {
  window.history.replaceState({}, '', '/m/mesa/cuenta?status=approved&payment_id=attacker')
  runPayment.mockResolvedValue(response)
  const redirect = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  const { container, click } = await renderPayment([pending])
  assert.deepEqual(runPayment.mock.calls[0], [{ action: 'status', paymentId }])
  assert.doesNotMatch(container.textContent ?? '', /Simular|fue aprobado/)
  assert.match(container.textContent ?? '', /Pago pendiente/)
  assert.ok(refreshTable.mock.calls.length > 0)
  await click('Continuar en Mercado Pago')
  assert.deepEqual(redirect.mock.calls[0], [checkoutUrl])
  assert.ok(runPayment.mock.calls.every(([input]: [MobilePaymentRequest]) => input.action === 'status'))
})

test('a lost create response survives remount and retries the same immutable request', async () => {
  runPayment.mockRejectedValueOnce(new AppError('CONNECTION_ERROR'))
  const first = await renderPayment()
  await first.click('Pagar ')
  const sent = runPayment.mock.calls[0][0] as MobilePaymentRequest
  assert.equal(sent.action, 'create')
  assert.equal(
    readCheckoutAttempt(sessionId, participantId)?.request.requestId,
    sent.action === 'create' ? sent.requestId : undefined,
  )
  first.unmount()

  runPayment.mockResolvedValue({ ...response, status: 'rejected', checkoutUrl: undefined })
  const second = await renderPayment()
  await second.click('Reintentar pago')
  assert.deepEqual(runPayment.mock.calls[1][0], sent)
  assert.match(second.container.textContent ?? '', /fue rechazado/)
  assert.equal(readCheckoutAttempt(sessionId, participantId), undefined)
})

test('a saved payment resumes verification after reload even when the ledger already changed', async () => {
  saveCheckoutAttempt(participantId, {
    request: { action: 'create', sessionId, requestId: '00000000-0000-4000-8000-000000000004', mode: 'full' },
    paymentId,
  })
  runPayment.mockResolvedValue({ ...response, status: 'approved', checkoutUrl: undefined })
  const { container } = await renderPayment()
  assert.deepEqual(runPayment.mock.calls[0][0], { action: 'status', paymentId })
  assert.match(container.textContent ?? '', /Tu pago fue aprobado/)
  assert.equal(readCheckoutAttempt(sessionId, participantId), undefined)
  assert.ok(refreshTable.mock.calls.length > 0)
})

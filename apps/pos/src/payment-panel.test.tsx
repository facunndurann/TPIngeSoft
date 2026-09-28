// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { formatPrice, type PaymentMethod } from '@restaurant-platform/shared'
import { AccessContext, type PosContext } from './context/pos-context'
import { PaymentPanel } from './features/pos/PaymentPanel'
import { recordPosPayment } from './features/pos/queries'
import { createPosQueryClient } from './lib/query-client'

// Sin red: el historial de pagos llega vacío y el cobro lo decide cada prueba.
vi.mock('./lib/supabase', () => ({ supabase: {} }))
vi.mock(import('./features/pos/queries'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    recordPosPayment: vi.fn(),
    // La misma query, con su key real, pero sin pasar por Supabase.
    sessionPaymentsQuery: (...args) => ({ ...original.sessionPaymentsQuery(...args), queryFn: async () => [] }),
  }
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cashier: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['payments.read', 'payments.write'],
}

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(recordPosPayment).mockReset()
})

/** El panel de una mesa, con una función para volver a dibujarlo con otro pendiente o medios. */
async function renderPanel(pendingAmount: number, enabledMethods: PaymentMethod[]) {
  const client = createPosQueryClient()
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const draw = async (pending: number, methods: PaymentMethod[]) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AccessContext value={cashier}>
            <PaymentPanel sessionId="session-a" pendingAmount={pending} enabledMethods={methods} />
          </AccessContext>
        </QueryClientProvider>,
      )
    })
  await draw(pendingAmount, enabledMethods)
  return { container, redraw: draw }
}

/** Escribe como lo haría una persona: React solo ve el cambio si pasa por el setter nativo. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

const amountIn = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="number"]')!
const methodIn = (container: HTMLElement) => container.querySelector('select')!

test('an untouched amount follows the balance, and a typed one survives another cashier charging', async () => {
  const { container, redraw } = await renderPanel(10, ['in_person', 'external'])
  assert.equal(amountIn(container).value, '10.00')

  // Otra caja cobró 4: el sugerido acompaña al pendiente nuevo.
  await redraw(6, ['in_person', 'external'])
  assert.equal(amountIn(container).value, '6.00')

  // Lo escrito a mano no se pisa cuando vuelve a cambiar el pendiente.
  await typeInto(amountIn(container), '2.50')
  await redraw(5, ['in_person', 'external'])
  assert.equal(amountIn(container).value, '2.50')
})

test('a method the admin disables falls back to the first one still enabled', async () => {
  const { container, redraw } = await renderPanel(10, ['in_person', 'external'])

  await choose(methodIn(container), 'external')
  assert.equal(methodIn(container).value, 'external')

  await redraw(10, ['in_person', 'mobile'])
  assert.equal(methodIn(container).value, 'in_person')
})

test('recording sends amount and method but no mode, then suggests the new balance', async () => {
  vi.mocked(recordPosPayment).mockResolvedValue('payment-a')
  const { container, redraw } = await renderPanel(10, ['in_person', 'external'])

  await typeInto(amountIn(container), '4')
  // Se dispara el submit directo: happy-dom valida `step` con punto flotante y
  // da por inválido 4 con min 0.01 y step 0.01, que un navegador acepta.
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()

  // El modo ('full' o 'custom') lo decide la RPC con el pendiente real.
  assert.deepEqual(vi.mocked(recordPosPayment).mock.calls, [
    [{ sessionId: 'session-a', amount: 4, method: 'in_person', externalReference: undefined }],
  ])

  // La relectura trae el pendiente nuevo, y el borrador ya no lo tapa.
  await redraw(6, ['in_person', 'external'])
  assert.equal(amountIn(container).value, '6.00')
})

/** El motivo que describe al campo del importe, siguiendo su aria-describedby. */
function amountMessage(container: HTMLElement) {
  const input = amountIn(container)
  const id = input.getAttribute('aria-describedby')
  return {
    invalid: input.getAttribute('aria-invalid') === 'true',
    message: id ? container.querySelector(`[id="${id}"]`)?.textContent ?? null : null,
  }
}

const registerIn = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Registrar'))!

test('the amount says why it cannot be recorded, next to the field, and the button waits', async () => {
  const { container } = await renderPanel(6000, ['in_person'])

  await typeInto(amountIn(container), '7000')
  assert.deepEqual(amountMessage(container), { invalid: true, message: `Supera el pendiente de ${formatPrice(6000)}.` })
  assert.equal(registerIn(container).disabled, true)

  await typeInto(amountIn(container), '0')
  assert.equal(amountMessage(container).message, 'El importe tiene que ser mayor a cero.')

  // La base rechaza más de dos decimales: el campo lo dice antes.
  await typeInto(amountIn(container), '10.005')
  assert.equal(amountMessage(container).message, 'Usá hasta dos decimales.')

  await typeInto(amountIn(container), '2500.50')
  assert.deepEqual(amountMessage(container), { invalid: false, message: null })
  assert.equal(registerIn(container).disabled, false)
})

test('an emptied amount only complains once the cashier leaves the field', async () => {
  const { container } = await renderPanel(6000, ['in_person'])

  await typeInto(amountIn(container), '')
  assert.deepEqual(amountMessage(container), { invalid: false, message: null })
  assert.equal(registerIn(container).disabled, true)

  await act(async () => { amountIn(container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  assert.equal(amountMessage(container).message, 'Ingresá el importe a registrar.')
})

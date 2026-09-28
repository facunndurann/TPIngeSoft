// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type PosContext } from './context/pos-context'
import { closePosSession, type PosOpenSession } from './features/pos/queries'
import { CloseSessionButton } from './features/pos/CloseSessionButton'
import { createPosQueryClient } from './lib/query-client'

// Sin red: el cliente de Supabase no llega a crearse y el cierre lo decide cada prueba.
vi.mock('./lib/supabase', () => ({ supabase: {} }))
vi.mock(import('./features/pos/queries'), async (importOriginal) => ({
  ...(await importOriginal()),
  closePosSession: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cashier: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['sessions.close'],
}

/** La fila de `pos_open_sessions` de Mesa 1, con lo que pisa cada prueba. */
const openAt = (overrides: Partial<PosOpenSession> = {}) =>
  ({
    id: 'session-a',
    table_label: 'Mesa 1',
    kitchen_tickets: 0,
    submitted_amount: 0,
    pending_amount: 0,
    ...overrides,
  }) as PosOpenSession

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(closePosSession).mockReset()
})

async function renderButton(session: PosOpenSession, context = cashier) {
  const client = createPosQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AccessContext value={context}>
          <CloseSessionButton session={session} />
        </AccessContext>
      </QueryClientProvider>,
    )
  })
  return { container, invalidate }
}

/** Deja correr las promesas de la mutación y los renders que disparan. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

const buttonIn = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent === text)

const dialogIn = (container: HTMLElement) => container.querySelector('dialog')

test('without sessions.close there is nothing to press', async () => {
  const { container } = await renderButton(openAt(), { ...cashier, permissions: ['orders.read'] })

  assert.equal(container.innerHTML, '')
})

test('the confirmation warns with what the session row says is still open', async () => {
  const { container } = await renderButton(openAt({ pending_amount: 1500, kitchen_tickets: 2, submitted_amount: 300 }))

  await act(async () => buttonIn(container, 'Cerrar mesa')!.click())

  const text = dialogIn(container)?.textContent ?? ''
  assert.match(text, /Cerrar Mesa 1/)
  assert.match(text, /pendiente/)
  assert.match(text, /Hay 2 comandas todavía en cocina/)
  assert.match(text, /pedidos enviados sin aceptar/)
  assert.equal(vi.mocked(closePosSession).mock.calls.length, 0)
  // «Cerrar sesión» es salir del POS: cerrar una mesa nunca lo dice.
  assert.doesNotMatch(container.textContent ?? '', /sesión/i)
})

test('confirming closes that session and refreshes the POS', async () => {
  vi.mocked(closePosSession).mockResolvedValue(undefined)
  const { container, invalidate } = await renderButton(openAt())

  await act(async () => buttonIn(container, 'Cerrar mesa')!.click())
  await act(async () => buttonIn(dialogIn(container)!, 'Cerrar mesa')!.click())
  await settle()

  assert.deepEqual(vi.mocked(closePosSession).mock.calls, [['session-a']])
  assert.deepEqual(invalidate.mock.calls, [[{ queryKey: ['pos'] }]])
  assert.equal(dialogIn(container), null)
})

test('a failed close keeps the dialog with its error, and reopening starts clean', async () => {
  vi.mocked(closePosSession).mockRejectedValue(new Error('La sesión ya estaba cerrada.'))
  const { container, invalidate } = await renderButton(openAt())

  await act(async () => buttonIn(container, 'Cerrar mesa')!.click())
  await act(async () => buttonIn(dialogIn(container)!, 'Cerrar mesa')!.click())
  await settle()

  assert.match(dialogIn(container)?.textContent ?? '', /La sesión ya estaba cerrada\./)
  assert.equal(buttonIn(dialogIn(container)!, 'Cerrar mesa')!.disabled, false)
  assert.equal(invalidate.mock.calls.length, 0)

  await act(async () => buttonIn(dialogIn(container)!, 'Seguir abierta')!.click())
  await act(async () => buttonIn(container, 'Cerrar mesa')!.click())

  assert.doesNotMatch(dialogIn(container)?.textContent ?? '', /La sesión ya estaba cerrada\./)
})

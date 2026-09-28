// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, scopeOf, type PosContext } from './context/pos-context'
import { usePosAlerts } from './features/pos/alerts'
import { playChime } from './features/pos/chime'
import { posBoardQuery, type PosOrder } from './features/pos/queries'

vi.mock('./features/pos/chime', () => ({ playChime: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const kitchen: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'orders.prepare'],
}
const boardKey = posBoardQuery(scopeOf(kitchen)).queryKey
const at = (id: string, status: PosOrder['status']) => ({ id, status }) as PosOrder

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(playChime).mockReset()
})

/** El hook montado como en PosPage, con el tablero ya en caché: sin red. */
async function mountAlerts(context: PosContext, board: PosOrder[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(boardKey, board)
  function Probe() {
    usePosAlerts()
    return null
  }
  const root = createRoot(document.createElement('div'))
  cleanups.push(() => act(() => root.unmount()))
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AccessContext value={context}><Probe /></AccessContext>
      </QueryClientProvider>,
    ),
  )
  // TanStack avisa a los componentes con un setTimeout(0): se espera ese tick
  // dentro del act, así el render y su efecto ya corrieron al volver.
  return (next: PosOrder[]) =>
    act(async () => {
      client.setQueryData(boardKey, next)
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
}

test('the kitchen hears an order arrive, not the ones already there when it opened', async () => {
  const updateBoard = await mountAlerts(kitchen, [at('o1', 'accepted')])
  assert.equal(vi.mocked(playChime).mock.calls.length, 0)

  await updateBoard([at('o1', 'accepted'), at('o2', 'accepted')])
  assert.equal(vi.mocked(playChime).mock.calls.length, 1)

  // Uno pasa a preparación: no llegó nada, no suena.
  await updateBoard([at('o1', 'in_preparation'), at('o2', 'accepted')])
  assert.equal(vi.mocked(playChime).mock.calls.length, 1)

  // Sale uno y entra otro en la misma lectura: la cantidad no cambia, pero hay uno nuevo.
  await updateBoard([at('o1', 'in_preparation'), at('o2', 'in_preparation'), at('o3', 'submitted')])
  assert.equal(vi.mocked(playChime).mock.calls.length, 2)
})

test('an account that does not prepare orders sees the count but hears nothing', async () => {
  const updateBoard = await mountAlerts({ ...kitchen, permissions: ['orders.read'] }, [])
  await updateBoard([at('o1', 'accepted')])
  assert.equal(vi.mocked(playChime).mock.calls.length, 0)
})

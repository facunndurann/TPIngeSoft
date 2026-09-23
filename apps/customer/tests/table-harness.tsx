/* eslint-disable react-refresh/only-export-components -- helper de pruebas: nunca pasa por fast refresh */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { PaymentMethod } from '@restaurant-platform/shared'
import { cartKeyFor, cartLock } from '../src/features/cart'
import { dinerIn } from '../src/features/diner'
import type { RequireName } from '../src/features/name-gate'
import { cartPrice } from '../src/features/menu'
import { type loadSession, sessionQuery } from '../src/features/session'
import { TableContext } from '../src/features/table-context'
import { TABLE_ROUTE } from '../src/features/table-paths'
import { useCart } from '../src/stores/cart'
import { menu } from './fixtures'

/*
 * Una mesa para las pruebas que renderizan pantallas. Publica el mismo contexto
 * que `TableApp`, armado con las mismas funciones (`dinerIn`, `cartPrice`, `cartLock`), y sirve
 * las consultas desde una caché sembrada: nada sale a la red. Cada archivo que la
 * usa mockea `src/lib/supabase`, y el mock alcanza también a los imports de acá.
 */

export const token = 'mesa-1'
export const sessionId = 'session-1'
const userId = 'user-1'
export const cartKey = cartKeyFor(sessionId, userId)

type Session = Awaited<ReturnType<typeof loadSession>>

export const ana: Session['participants'][number] = {
  id: 'participant-ana',
  session_id: sessionId,
  user_id: userId,
  display_name: 'Ana',
  joined_at: '2026-09-22T20:00:00Z',
  named_at: '2026-09-22T20:00:00Z',
}

/** Una mesa abierta con Ana sola, sin división elegida ni avisos al salón. */
export const openSession: Session = {
  id: sessionId,
  table_id: 'table-1',
  restaurant_id: 'restaurant-1',
  status: 'open',
  opened_at: '2026-09-22T20:00:00Z',
  closed_at: null,
  assigned_employee_id: null,
  assigned_user_id: null,
  bill_requested_at: null,
  bill_attended_at: null,
  in_person_payment_requested_at: null,
  in_person_payment_attended_at: null,
  split_type: 'none',
  split_allocations: {},
  split_equal_parts: null,
  split_updated_at: null,
  split_updated_by: null,
  participants: [ana],
}

type TableOptions = {
  /** Medios de pago de la sucursal; por defecto, los de la columna en la base. */
  paymentMethods?: PaymentMethod[]
  /** Lo que la mesa ya leyó, además de la sesión: como si la red hubiera respondido. */
  seed?: (client: QueryClient) => void
  /** Cómo se pide el nombre. Por defecto Ana ya lo eligió y todo pasa en el acto. */
  requireName?: RequireName
}

const cleanups: (() => void)[] = []

/** Desmonta lo renderizado y vacía el carrito. Va en el `afterEach` de cada archivo. */
export function cleanupTables() {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  useCart.setState({ carts: {}, submissions: {} })
}

/** Renderiza `routes` dentro de la ruta de la mesa, parado en `path`. */
export async function renderTable(
  path: string,
  routes: ReactNode,
  { paymentMethods = ['in_person', 'external'], seed, requireName = (action) => action() }: TableOptions = {},
) {
  // Sin refetch al montar ni reintentos: lo sembrado es lo que hay.
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(sessionQuery(sessionId).queryKey, openSession)
  seed?.(client)

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={TABLE_ROUTE} element={<Table paymentMethods={paymentMethods} requireName={requireName} />}>
              {routes}
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  return container
}

/** Deja correr mutaciones, sus callbacks y las navegaciones que disparan. */
export async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

/** La ruta en la que quedó la mesa: la escribe `Table` en un `<output>`. */
export const pathnameIn = (container: HTMLElement) => container.querySelector('output')?.textContent

function Table({ paymentMethods, requireName }: { paymentMethods: PaymentMethod[]; requireName: RequireName }) {
  const menuQuery = useQuery({ queryKey: ['menu'], queryFn: () => menu, initialData: menu })
  const session = useQuery(sessionQuery(sessionId))
  const items = useCart((state) => state.carts[cartKey]) ?? []
  const pending = useCart((state) => !!state.submissions[cartKey])
  const sessionOpen = session.data?.status === 'open'
  const diner = dinerIn(session.data, userId)
  const { pathname } = useLocation()

  return (
    <TableContext
      value={{
        token,
        menu: menuQuery,
        session,
        sessionId,
        refreshTable: async () => {},
        ...diner,
        requireName,
        sessionOpen,
        cartKey,
        items,
        cartTotal: cartPrice(menu, items),
        paymentMethods,
        editLock: cartLock({ sessionOpen, closed: diner.closed, pending }),
        announce: () => {},
      }}
    >
      <output>{pathname}</output>
      <Outlet />
    </TableContext>
  )
}

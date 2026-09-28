import { test } from 'vitest'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import { AuthContext } from '@restaurant-platform/ui'
import { AccessContext, type PosContext } from './context/pos-context'
import { OrderTicket } from './features/pos/OrderTicket'
import type { PosOrder } from './features/pos/queries'

const context: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'orders.prepare'],
}

const order = {
  id: 'order-a',
  status: 'ready',
  total_amount: 20,
  created_at: new Date().toISOString(),
  order_items: [],
  table_sessions: {
    status: 'open',
    session_participants: [],
    tables: { label: 'Mesa 1' },
  },
} as unknown as PosOrder

/** Renderiza la app entera con una sesión y unos contextos ya resueltos. */
function app(session: Session | null, contexts: PosContext[], route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (session) client.setQueryData(['pos-contexts', session.user.id], contexts)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthContext value={{ session, loading: false }}>
          <App />
        </AuthContext>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const employee = { user: { id: 'employee' } } as Session
const twoContexts = [context, { ...context, branch_id: 'branch-b', branch_name: 'Branch B' }]
test('POS login renders username/password independently of admin', () => {
  const html = app(null, [], '/login')
  assert.match(html, /autoComplete="username"/)
  assert.match(html, /type="password"/)
  assert.doesNotMatch(html, /PIN|type="email"/)
})

test('single context resolves directly and kitchen navigation excludes cash and admin', () => {
  const html = app(employee, [context], '/')
  assert.match(html, /Restaurant A/)
  assert.match(html, /Branch A/)
  assert.doesNotMatch(html, /Mesas activas|Historial|Cambiar sucursal|href="\/productos"/)
})

test('selector lists only supplied authorized contexts', () => {
  const html = app(employee, twoContexts, '/select-context')
  assert.match(html, /Branch A/)
  assert.match(html, /Branch B/)
  assert.doesNotMatch(html, /Restaurant B/)
})

test('account without active context is denied', () => {
  const html = app(employee, [], '/')
  assert.match(html, /Acceso no habilitado/)
  assert.doesNotMatch(html, /Comandas/)
})

test('kitchen cannot deliver, revert or cancel from ticket buttons', () => {
  // El ticket es dueño de su mutación: necesita un QueryClient como en la app.
  const ticket = (status: PosOrder['status']) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AccessContext value={context}>
          <OrderTicket order={{ ...order, status }} now={Date.now()} />
        </AccessContext>
      </QueryClientProvider>,
    )

  // 'ready' solo avanza a 'delivered', y cocina no tiene orders.deliver.
  assert.doesNotMatch(ticket('ready'), /<button/)

  const preparing = ticket('in_preparation')
  assert.match(preparing, /Marcar listo/)
  assert.doesNotMatch(preparing, /Cancelar|Volver a nuevo/)
})

// La elección guardada es una comodidad de la tablet, nunca una autorización:
// get_pos_contexts sigue siendo la única fuente de verdad.
function withStoredContext(value: string | null, run: () => string) {
  const store = new Map<string, string>()
  if (value) store.set('pos-context:employee', value)
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, stored: string) => void store.set(key, stored),
    },
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}
test('a stored context survives a reload without asking again', () => {
  const html = withStoredContext('restaurant-a:branch-b', () => app(employee, twoContexts, '/'))
  assert.match(html, /Pedidos en vivo/)
  assert.match(html, /Branch B/)
  assert.doesNotMatch(html, /Elegí dónde vas a trabajar/)
})

test('a stored context that is no longer authorized never grants access', () => {
  const stale = () => app(employee, twoContexts, '/')
  assert.doesNotMatch(withStoredContext('restaurant-b:branch-z', stale), /Pedidos en vivo|Branch Z/)
  const selector = () => app(employee, twoContexts, '/select-context')
  assert.match(withStoredContext('restaurant-b:branch-z', selector), /Elegí dónde vas a trabajar/)
})

test('the selector still works where sessionStorage is unavailable', () => {
  assert.match(app(employee, twoContexts, '/select-context'), /Elegí dónde vas a trabajar/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import { AuthContext } from '@restaurant-platform/ui'
import { AccessContext, type PosContext } from './context/pos-context'
import { OrderTicket } from './features/pos/OrderTicket'
import type { PosOrder } from './features/pos/types'

const context: PosContext = { restaurant_id:'restaurant-a',restaurant_name:'Restaurant A',branch_id:'branch-a',branch_name:'Branch A',full_name:'Ana',permissions:['orders.read','orders.prepare'] }
const order = { id:'order-a',status:'ready',total_amount:20,created_at:new Date().toISOString(),order_items:[],table_sessions:{ status:'open',session_participants:[],tables:{ label:'Mesa 1',branch:{name:'Central'} } } } as unknown as PosOrder
function app(session: Session | null, contexts: PosContext[], route: string) {
  const client = new QueryClient({ defaultOptions:{queries:{retry:false,staleTime:Infinity}} })
  if (session) client.setQueryData(['pos-contexts',session.user.id],contexts)
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><AuthContext value={{session,loading:false}}><App /></AuthContext></MemoryRouter></QueryClientProvider>)
}
test('POS login renders username/password independently of admin', () => {
  const html=app(null,[],'/login')
  assert.match(html,/autoComplete="username"/)
  assert.match(html,/type="password"/)
  assert.doesNotMatch(html,/PIN|type="email"/)
})
test('single context resolves directly and kitchen navigation excludes cash and admin', () => {
  const html=app({user:{id:'employee'}} as Session,[context],'/')
  assert.match(html,/Restaurant A/)
  assert.match(html,/Branch A/)
  assert.doesNotMatch(html,/Mesas activas|Historial|Cambiar sucursal|href="\/productos"/)
})
test('selector lists only supplied authorized contexts', () => {
  const html=app({user:{id:'employee'}} as Session,[context,{...context,branch_id:'branch-b',branch_name:'Branch B'}],'/select-context')
  assert.match(html,/Branch A/); assert.match(html,/Branch B/)
  assert.doesNotMatch(html,/Restaurant B/)
})
test('account without active context is denied', () => {
  const html=app({user:{id:'employee'}} as Session,[],'/')
  assert.match(html,/Acceso no habilitado/)
  assert.doesNotMatch(html,/Comandas/)
})
test('kitchen cannot deliver, revert or cancel from ticket buttons', () => {
  const html=renderToStaticMarkup(<AccessContext value={context}><OrderTicket order={order} now={Date.now()} busy={false} error={null} onTransition={()=>{}} /></AccessContext>)
  assert.doesNotMatch(html,/<button/)
  const ready=renderToStaticMarkup(<AccessContext value={context}><OrderTicket order={{...order,status:'in_preparation'}} now={Date.now()} busy={false} error={null} onTransition={()=>{}} /></AccessContext>)
  assert.match(ready,/Marcar listo/); assert.doesNotMatch(ready,/Cancelar|Volver a nuevo/)
})

// La elección guardada es una comodidad de la tablet, nunca una autorización:
// get_pos_contexts sigue siendo la única fuente de verdad.
function withStoredContext(value: string | null, run: () => string) {
  const store = new Map<string, string>()
  if (value) store.set('pos-context:employee', value)
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  })
  try { return run() } finally { Reflect.deleteProperty(globalThis, 'sessionStorage') }
}
const twoContexts = [context, { ...context, branch_id: 'branch-b', branch_name: 'Branch B' }]
test('a stored context survives a reload without asking again', () => {
  const html = withStoredContext('restaurant-a:branch-b', () => app({user:{id:'employee'}} as Session, twoContexts, '/'))
  assert.match(html, /Pedidos en vivo/)
  assert.match(html, /Branch B/)
  assert.doesNotMatch(html, /Elegí dónde vas a trabajar/)
})
test('a stored context that is no longer authorized never grants access', () => {
  const stale = () => app({user:{id:'employee'}} as Session, twoContexts, '/')
  assert.doesNotMatch(withStoredContext('restaurant-b:branch-z', stale), /Pedidos en vivo|Branch Z/)
  const selector = () => app({user:{id:'employee'}} as Session, twoContexts, '/select-context')
  assert.match(withStoredContext('restaurant-b:branch-z', selector), /Elegí dónde vas a trabajar/)
})
test('the selector still works where sessionStorage is unavailable', () => {
  assert.match(app({user:{id:'employee'}} as Session, twoContexts, '/select-context'), /Elegí dónde vas a trabajar/)
})

// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppError, appErrors } from '@restaurant-platform/shared'
import { QueryView, type QueryState } from '@restaurant-platform/ui'
import { AccessContext, type PosContext } from './context/pos-context'
import { TableCommand } from './features/pos/TableCommand'
import {
  posOpenSessionsQuery,
  posPaymentMethodsQuery,
  posTablesQuery,
  sessionOrdersQuery,
  type PosDiningTable,
  type PosOpenSession,
} from './features/pos/queries'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** Un resultado de consulta sin react-query: QueryView solo lee estos tres campos. */
const query = <T,>(data: T | undefined, error: unknown = null, refetch = () => {}): QueryState<T> =>
  ({ data, error, refetch })

const failed = new AppError('SERVER_ERROR')
const html = (node: ReactNode) => renderToStaticMarkup(node)

test('a failed first load shows the error with its retry, never the empty state', () => {
  const markup = html(
    <QueryView query={query<string[]>(undefined, failed)} empty="Todavía no hay categorías.">
      {() => 'contenido'}
    </QueryView>,
  )
  assert.match(markup, new RegExp(appErrors.SERVER_ERROR.message))
  assert.match(markup, />Reintentar</)
  assert.doesNotMatch(markup, /Todavía no hay categorías|contenido|Cargando/)
})

test('without data or error it is loading, and children never run', () => {
  let ran = false
  const markup = html(
    <QueryView query={query<string[]>(undefined)}>{() => { ran = true; return 'contenido' }}</QueryView>,
  )
  assert.match(markup, /role="status"/)
  assert.match(markup, /Cargando…/)
  assert.equal(ran, false)
})

test('loaded data shows the content, or the empty state when there is nothing', () => {
  assert.match(html(<QueryView query={query(['Postres'])} empty="Vacío">{(rows) => rows.join()}</QueryView>), /Postres/)
  const empty = html(<QueryView query={query<string[]>([])} empty="Todavía no hay categorías.">{() => 'contenido'}</QueryView>)
  assert.match(empty, /Todavía no hay categorías\./)
  assert.doesNotMatch(empty, /contenido/)
})

test('a failed refetch keeps the data on screen and warns above it', () => {
  const markup = html(<QueryView query={query(['Mesa 1'], failed)}>{(rows) => rows.join()}</QueryView>)
  assert.match(markup, /role="alert"/)
  assert.match(markup, /Mesa 1/)
  assert.ok(markup.indexOf('role="alert"') < markup.indexOf('Mesa 1'), 'El aviso va arriba de los datos')
})

test('several queries wait for all of them and hand their data over in order', () => {
  const loading = html(
    <QueryView query={[query(['a']), query<number[]>(undefined)]}>{() => 'contenido'}</QueryView>,
  )
  assert.match(loading, /Cargando…/)

  const failing = html(
    <QueryView query={[query(['a']), query<number[]>(undefined, failed)]}>{() => 'contenido'}</QueryView>,
  )
  assert.match(failing, />Reintentar</)
  assert.doesNotMatch(failing, /contenido/)

  const loaded = html(
    <QueryView query={[query(['a', 'b']), query([1])]} empty="Vacío" isEmpty={([letters]) => letters.length === 0}>
      {([letters, numbers]) => `${letters.join('')}-${numbers.join('')}`}
    </QueryView>,
  )
  assert.match(loaded, /ab-1/)
})

test('retrying refetches only the queries that failed', async () => {
  const calls: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryView
        query={[
          query(['a'], null, () => calls.push('ok')),
          query<string[]>(undefined, failed, () => calls.push('failed')),
        ]}
      >
        {() => 'contenido'}
      </QueryView>,
    ),
  )
  await act(async () => container.querySelector('button')!.click())
  assert.deepEqual(calls, ['failed'])
  act(() => root.unmount())
  container.remove()
})

test('a table whose orders failed to load says so instead of «no orders yet»', () => {
  const context: PosContext = {
    restaurant_id: 'restaurant-a',
    restaurant_name: 'Restaurant A',
    branch_id: 'branch-a',
    branch_name: 'Branch A',
    full_name: 'Ana',
    permissions: ['orders.read', 'floor.read'],
  }
  const table = { id: 'table-1', label: 'Mesa 1', seats: 4, floor_sections: null } as unknown as PosDiningTable
  const session = {
    id: 'session-1',
    table_id: 'table-1',
    opened_at: new Date().toISOString(),
    total_amount: null,
    participant_names: [],
    kitchen_tickets: 0,
    kitchen_statuses: [],
    has_pending_payment: false,
    assigned_employee_name: null,
  } as unknown as PosOpenSession

  // Sin `retryOnMount`, una consulta en error se muestra como quedó: si no, montarla
  // la vuelve a pedir y su primer estado es «cargando».
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  })
  client.setQueryData(posTablesQuery('restaurant-a', 'branch-a').queryKey, [table])
  client.setQueryData(posOpenSessionsQuery('restaurant-a', 'branch-a').queryKey, [session])
  client.setQueryData(posPaymentMethodsQuery('restaurant-a', 'branch-a').queryKey, [])
  // La lectura de los pedidos ya falló: está en error y sin datos.
  client
    .getQueryCache()
    .build(client, { queryKey: sessionOrdersQuery('restaurant-a', 'branch-a', 'session-1').queryKey })
    .setState({ status: 'error', error: failed, errorUpdatedAt: Date.now(), fetchStatus: 'idle' })

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/salon/table-1']}>
        <AccessContext value={context}>
          <Routes>
            <Route path="/salon/:tableId" element={<TableCommand />} />
          </Routes>
        </AccessContext>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  assert.match(markup, /Mesa 1/)
  assert.match(markup, new RegExp(appErrors.SERVER_ERROR.message))
  assert.match(markup, />Reintentar</)
  assert.doesNotMatch(markup, /Todavía no hay pedidos/)
})

afterEach(() => {
  document.body.innerHTML = ''
})

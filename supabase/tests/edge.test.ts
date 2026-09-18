import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitOrderSchema } from '../../packages/shared/src/orders.ts'
import {
  dayRangeUtc,
  formatElapsed,
  groupOrdersByColumn,
  getPosTableState,
  isKitchenTicket,
  posActions,
  posColumnFor,
  posErrorCode,
} from '../../packages/shared/src/pos.ts'
// Si otra migración vuelve a redefinir transition_order, apuntá este import a esa.
import transitionOrderSql from '../migrations/20260915130000_pos_transition_table.sql?raw'
import {
  FLOOR_GRID,
  TABLE_SPAN,
  clampSpan,
  clampToGrid,
  collidesWithAny,
  findFreeCell,
  isOperable,
  tableFootprint,
  tableShapes,
} from '../../packages/shared/src/floor.ts'
// Si otra migración cambia el check de shape o el rango de width/height,
// apuntá este import a esa.
import floorLayoutSql from '../migrations/20260918030000_free_table_sizes.sql?raw'
import { DEFAULT_MENU_DESIGN } from '../../packages/shared/src/designs.ts'
// Si otra migración cambia el default de restaurants.menu_design, apuntá este import a esa.
import menuDesignEnumSql from '../migrations/20260915150000_menu_design_enum.sql?raw'
import { createSubmitOrderHandler } from '../functions/submit-order/handler.ts'
import { databaseError } from '../functions/_shared/errors.ts'
import type { OrderGateway, PosOrder } from '../functions/_shared/pos/adapter.ts'

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false }],
  expectedTotal: 20.2,
}
const request = (body: unknown = input, headers: Record<string, string> = { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }) => new Request('http://local/submit-order', { method: 'POST', headers, body: JSON.stringify(body) })
function fixture() {
  let status: PosOrder['status'] = 'submitted'
  let sends = 0
  let creates = 0
  const gateway: OrderGateway = {
    submit: async () => { creates++; return input.requestId },
    loadOrder: async () => ({ id: input.requestId, status, total_amount: 20.2 } as PosOrder),
    posType: async () => 'internal',
    dispatchInternal: async () => { sends++; status = 'accepted' },
  }
  return { gateway, sends: () => sends, creates: () => creates }
}

test('schema rejects forged amounts, attribution, invalid quantities and duplicate selections', () => {
  assert.equal(submitOrderSchema.safeParse(input).success, true)
  for (const value of [NaN, Infinity, -1, .001, 100000000]) assert.equal(submitOrderSchema.safeParse({ ...input, expectedTotal: value }).success, false)
  for (const quantity of [0, 1.5, 100, '2']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity }] }).success, false)
  for (const field of ['optionIds', 'removedIds']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], [field]: [input.sessionId, input.sessionId] }] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, participantId: input.sessionId }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], basePrice: 0 }] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: Array(51).fill(input.items[0]) }).success, false)
})

test('preflight and wrong method never authenticate or create orders', async () => {
  const handler = createSubmitOrderHandler(async () => { throw new Error('should not authenticate') })
  const preflight = await handler(new Request('http://local', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('Access-Control-Allow-Headers')!, /authorization/)
  assert.equal((await handler(new Request('http://local'))).status, 405)
})

test('requires a verified identity and valid bounded JSON', async () => {
  const { gateway, creates } = fixture()
  const handler = createSubmitOrderHandler(async jwt => {
    if (jwt !== 'valid-user') throw databaseError({ message: 'AUTH_REQUIRED' })
    return gateway
  })
  assert.equal((await handler(request(input, { 'Content-Type': 'application/json' }))).status, 401)
  assert.equal((await handler(request(input, { Authorization: 'Bearer forged', 'Content-Type': 'application/json' }))).status, 401)
  assert.equal((await handler(request({ ...input, items: [] }))).status, 400)
  assert.equal((await handler(request('x'.repeat(128 * 1024)))).status, 413)
  const malformed = new Request('http://local', { method: 'POST', headers: { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }, body: '{' })
  assert.equal((await handler(malformed)).status, 400)
  assert.equal(creates(), 0)
})

test('dispatches through the internal adapter and returns server prices and status', async () => {
  const { gateway, sends } = fixture()
  const handler = createSubmitOrderHandler(async () => gateway)
  const result = await handler(request())
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { orderId: input.requestId, status: 'accepted', totalAmount: 20.2 })
  await handler(request())
  assert.equal(sends(), 1, 'an already received order must not be dispatched again')
})

test('price changes do not dispatch, errors retain a safe actionable code', async () => {
  const { gateway, sends } = fixture()
  gateway.submit = async () => { throw databaseError({ message: 'PRICE_CHANGED' }) }
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'PRICE_CHANGED')
  assert.equal(sends(), 0)
})

test('adapter failure preserves submission and retry delivers the same order', async () => {
  const { gateway, sends } = fixture()
  const dispatch = gateway.dispatchInternal
  gateway.dispatchInternal = async () => { throw new Error('private backend detail') }
  const handler = createSubmitOrderHandler(async () => gateway)
  const failed = await handler(request())
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /private backend detail/)
  gateway.dispatchInternal = dispatch
  const retry = await handler(request())
  assert.equal((await retry.json()).orderId, input.requestId)
  assert.equal(sends(), 1)
})

test('unsupported POS is explicit and never silently falls back to internal', async () => {
  const { gateway, sends } = fixture()
  gateway.posType = async () => 'fudo'
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'POS_UNSUPPORTED')
  assert.equal(sends(), 0)
})

test('POS board groups kitchen columns, FIFO in prep/ready, and newest first otherwise', () => {
  const orders = [
    { id: 'd', status: 'delivered', created_at: '2026-09-05T12:00:00.000Z' },
    { id: 'n2', status: 'accepted', created_at: '2026-09-05T12:05:00.000Z' },
    { id: 'p-old', status: 'in_preparation', created_at: '2026-09-05T11:00:00.000Z' },
    { id: 'p-new', status: 'in_preparation', created_at: '2026-09-05T11:30:00.000Z' },
    { id: 'n1', status: 'submitted', created_at: '2026-09-05T12:01:00.000Z' },
    { id: 'r', status: 'ready', created_at: '2026-09-05T10:00:00.000Z' },
    { id: 'c', status: 'cancelled', created_at: '2026-09-05T12:00:00.000Z' },
  ] as const
  const grouped = groupOrdersByColumn([...orders])
  assert.deepEqual(grouped.new.map((order) => order.id), ['n2', 'n1'])
  assert.deepEqual(grouped.in_preparation.map((order) => order.id), ['p-old', 'p-new'])
  assert.deepEqual(grouped.ready.map((order) => order.id), ['r'])
  assert.deepEqual(grouped.delivered.map((order) => order.id), ['d'])
  assert.equal(posColumnFor('cancelled'), null)
  assert.equal(posActions.accepted.advance?.to, 'in_preparation')
  assert.equal(posActions.ready.cancel?.to, 'cancelled')
  assert.equal(posActions.delivered.cancel, undefined)
  assert.equal(posActions.cancelled.cancel, undefined)
  assert.equal(isKitchenTicket('ready'), true)
  assert.equal(isKitchenTicket('delivered'), false)
  assert.equal(isKitchenTicket('cancelled'), false)
})

test('transition_order accepts exactly the transitions posActions offers', () => {
  const offered = Object.entries(posActions)
    .flatMap(([from, actions]) => Object.values(actions).map((step) => `${from} -> ${step.to}`))
    .sort()

  // Pares ('desde', 'hacia') del bloque `not in (values …) then` de la migración.
  const valuesBlock = transitionOrderSql.match(/not in \(values([\s\S]*?)\)\s*then/)?.[1]
  assert.ok(valuesBlock, 'transition_order must list its allowed pairs in a VALUES block')
  const allowed = [...valuesBlock.matchAll(/\('(\w+)'(?:::[\w.]+)?,\s*'(\w+)'/g)]
    .map(([, from, to]) => `${from} -> ${to}`)
    .sort()

  assert.deepEqual(allowed, offered)
  // Revertir retrocede exactamente una etapa: nunca a submitted ni desde cancelled.
  assert.deepEqual(
    Object.entries(posActions).flatMap(([from, { revert }]) => (revert ? [`${from} -> ${revert.to}`] : [])),
    ['in_preparation -> accepted', 'ready -> in_preparation', 'delivered -> ready'],
  )
})

test('restaurant day bounds use Argentina time and POS errors stay coded', () => {
  assert.deepEqual(dayRangeUtc('2026-09-05'), {
    start: '2026-09-05T03:00:00.000Z',
    end: '2026-09-06T03:00:00.000Z',
  })
  assert.equal(formatElapsed('2026-09-05T12:00:00.000Z', Date.parse('2026-09-05T12:00:30.000Z')), 'Ahora')
  assert.equal(formatElapsed('2026-09-05T12:00:00.000Z', Date.parse('2026-09-05T13:05:00.000Z')), 'Hace 1 h 5 min')
  assert.equal(posErrorCode('FORBIDDEN'), 'FORBIDDEN')
  assert.equal(posErrorCode('P0001: INVALID_TRANSITION'), 'INVALID_TRANSITION')
})

test('table map states follow operational priority without inventing occupancy', () => {
  assert.equal(getPosTableState({ hasOpenSession: false, billRequestedAt: '2026-09-18' }), 'free')
  assert.equal(getPosTableState({ hasOpenSession: true }), 'occupied')
  assert.equal(getPosTableState({ hasOpenSession: true, orderStatuses: ['delivered'] }), 'occupied')
  assert.equal(getPosTableState({ hasOpenSession: true, orderStatuses: ['accepted'] }), 'order_pending')
  assert.equal(getPosTableState({ hasOpenSession: true, orderStatuses: ['in_preparation'] }), 'in_preparation')
  assert.equal(getPosTableState({ hasOpenSession: true, orderStatuses: ['submitted', 'ready'] }), 'ready')
  assert.equal(getPosTableState({
    hasOpenSession: true,
    orderStatuses: ['ready'],
    billRequestedAt: '2026-09-18T12:00:00Z',
  }), 'bill_requested')
  assert.equal(getPosTableState({
    hasOpenSession: true,
    billRequestedAt: '2026-09-18T12:00:00Z',
    hasPendingPayment: true,
  }), 'payment_pending')
})

test('the database default menu design matches DEFAULT_MENU_DESIGN', () => {
  assert.equal(menuDesignEnumSql.match(/alter column menu_design set default '(\w+)'/)?.[1], DEFAULT_MENU_DESIGN)
})

test('table sizes are free but always drawable inside the grid', () => {
  assert.deepEqual(tableFootprint({ width: 5, height: 2 }), { w: 5, h: 2 })
  assert.deepEqual(tableFootprint({ width: 1, height: 1 }), { w: 1, h: 1 })

  // Datos fuera de rango no rompen el plano: se recortan al dibujar.
  assert.deepEqual(tableFootprint({ width: 0, height: -3 }), {
    w: TABLE_SPAN.min,
    h: TABLE_SPAN.min,
  })
  assert.deepEqual(tableFootprint({ width: 999, height: 999 }), {
    w: TABLE_SPAN.max,
    h: TABLE_SPAN.max,
  })
  assert.equal(clampSpan(3.6, FLOOR_GRID.cols), 4)
  // El límite del eje manda sobre el tope general.
  assert.equal(clampSpan(99, 5), 5)

  const big = tableFootprint({ width: 5, height: 4 })
  assert.deepEqual(clampToGrid(-5, -5, big), { x: 0, y: 0 })
  assert.deepEqual(clampToGrid(999, 999, big), {
    x: FLOOR_GRID.cols - big.w,
    y: FLOOR_GRID.rows - big.h,
  })
  assert.deepEqual(clampToGrid(4.4, 6.6, big), { x: 4, y: 7 })
})

test('tables collide when they overlap and fit when they only touch', () => {
  const footprint = tableFootprint({ width: 3, height: 3 })
  const anchor = { x: 3, y: 3, footprint }

  assert.equal(collidesWithAny({ x: 5, y: 3, footprint }, [anchor]), true)
  // Pegada al borde derecho: comparten borde, no celdas.
  assert.equal(collidesWithAny({ x: 6, y: 3, footprint }, [anchor]), false)
  assert.equal(collidesWithAny({ x: 3, y: 6, footprint }, [anchor]), false)

  // El hueco que propone una mesa nueva nunca pisa a las existentes.
  const taken = [anchor, { x: 0, y: 0, footprint }]
  const free = findFreeCell(footprint, taken)
  assert.equal(collidesWithAny({ ...free, footprint }, taken), false)
})

test('a hidden table, one out of service, or one in a closed section is never operable', () => {
  const open = { is_active: true }
  const closed = { is_active: false }

  assert.equal(isOperable({ is_active: true, is_visible: true }), true)
  assert.equal(isOperable({ is_active: true, is_visible: false }), false)
  assert.equal(isOperable({ is_active: false, is_visible: true }), false)

  // Un sector dado de baja saca de la operación hasta a sus mesas sanas.
  assert.equal(isOperable({ is_active: true, is_visible: true }, open), true)
  assert.equal(isOperable({ is_active: true, is_visible: true }, closed), false)
  assert.equal(isOperable({ is_active: true, is_visible: false }, open), false)

  // Sin sector la mesa sigue siendo operable: existe y tiene QR.
  assert.equal(isOperable({ is_active: true, is_visible: true }, null), true)
})

test('the database accepts exactly the shapes the floor editor offers', () => {
  const listed = floorLayoutSql
    .match(/tables_shape_valid check \(shape in \(([^)]*)\)/)?.[1]
    .match(/'(\w+)'/g)
    ?.map((value) => value.replaceAll("'", ''))
    .sort()
  assert.deepEqual(listed, [...tableShapes].sort())

  // El tope de la DB no puede quedar por debajo del que ofrece el editor.
  const span = floorLayoutSql.match(/width between (\d+) and (\d+)/)
  assert.ok(span, 'the migration must bound width and height')
  assert.ok(Number(span[1]) <= TABLE_SPAN.min && Number(span[2]) >= TABLE_SPAN.max)
})

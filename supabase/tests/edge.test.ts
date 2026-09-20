import { test } from 'vitest'
import assert from 'node:assert/strict'
import { type OrderStatus, submitOrderErrorSchema, submitOrderResultSchema, submitOrderSchema } from '../../packages/shared/src/orders.ts'
import { AppError, appErrorMessage, appErrors, fromPostgres, isRetryableError } from '../../packages/shared/src/errors.ts'
import {
  formatElapsed,
  getPosTableState,
  isKitchenTicket,
  posActions,
  sessionRequestKinds,
  sessionRequestLabels,
  sessionRequestsOf,
  sessionRequestState,
} from '../../packages/shared/src/pos.ts'
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
import type { OrderGateway } from '../functions/_shared/order-gateway.ts'

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false }],
  expectedTotal: 20.2,
}
const request = (body: unknown = input, headers: Record<string, string> = { Authorization: 'Bearer valid-user', 'Content-Type': 'application/json' }) => new Request('http://local/submit-order', { method: 'POST', headers, body: JSON.stringify(body) })
const accepted = { orderId: input.requestId, status: 'accepted', totalAmount: 20.2 } as const
function fixture() {
  let creates = 0
  const gateway: OrderGateway = {
    submit: async () => { creates++; return accepted },
  }
  return { gateway, creates: () => creates }
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
    if (jwt !== 'valid-user') throw new AppError('AUTH_REQUIRED')
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

test('returns the order status and total confirmed by submit_order', async () => {
  const { gateway, creates } = fixture()
  const result = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), accepted)
  assert.equal(creates(), 1)
})

test('database errors answer with the status, code and message of the shared catalog', async () => {
  const { gateway } = fixture()
  const handler = createSubmitOrderHandler(async () => gateway)
  for (const code of ['PRICE_CHANGED', 'REQUEST_ABANDONED', 'POS_UNAVAILABLE'] as const) {
    gateway.submit = async () => { throw fromPostgres({ message: code }) }
    const response = await handler(request())
    assert.equal(response.status, appErrors[code].status)
    const body = submitOrderErrorSchema.parse(await response.json())
    assert.deepEqual(body.error, { code, message: appErrors[code].message })
  }
})

test('successful responses match the shared result schema', async () => {
  const { gateway } = fixture()
  const response = await createSubmitOrderHandler(async () => gateway)(request())
  assert.deepEqual(submitOrderResultSchema.parse(await response.json()), accepted)
  assert.equal(submitOrderResultSchema.safeParse({ ...accepted, status: 'lost' }).success, false)
  assert.equal(submitOrderResultSchema.safeParse({ ...accepted, totalAmount: '20.2' }).success, false)
})

test('unexpected failures never leak backend details', async () => {
  const { gateway } = fixture()
  gateway.submit = async () => { throw new Error('private backend detail') }
  const failed = await createSubmitOrderHandler(async () => gateway)(request())
  assert.equal(failed.status, 503)
  const body = await failed.text()
  assert.doesNotMatch(body, /private backend detail/)
  assert.equal(JSON.parse(body).error.code, 'SERVER_ERROR')
})

test('POS actions advance and cancel until delivery, and nothing leaves cancelled', () => {
  assert.equal(posActions.accepted.advance?.to, 'in_preparation')
  assert.equal(posActions.ready.cancel?.to, 'cancelled')
  assert.equal(posActions.delivered.advance, undefined)
  assert.equal(posActions.delivered.cancel, undefined)
  assert.deepEqual(posActions.cancelled, {})
  assert.equal(isKitchenTicket('ready'), true)
  assert.equal(isKitchenTicket('delivered'), false)
  assert.equal(isKitchenTicket('cancelled'), false)
})

test('elapsed time reads naturally and POS errors stay coded', () => {
  assert.equal(formatElapsed('2026-09-05T12:00:00.000Z', Date.parse('2026-09-05T12:00:30.000Z')), 'Ahora')
  assert.equal(formatElapsed('2026-09-05T12:00:00.000Z', Date.parse('2026-09-05T13:05:00.000Z')), 'Hace 1 h 5 min')
  // Un solo traductor para las tres formas en que llega un error de Postgres.
  assert.equal(fromPostgres('FORBIDDEN').code, 'FORBIDDEN')
  assert.equal(fromPostgres({ message: 'P0001: INVALID_TRANSITION' }).code, 'INVALID_TRANSITION')
  assert.equal(fromPostgres('TABLE_OCCUPIED').code, 'TABLE_OCCUPIED')
  const constraint = fromPostgres('duplicate key violates "tables_label_unique_per_branch"')
  assert.equal(constraint.code, 'TABLE_LABEL_TAKEN')
  assert.equal(constraint.message, appErrors.TABLE_LABEL_TAKEN.message)
  // Lo desconocido no filtra el detalle interno: mensaje del catálogo y nada más.
  const unknown = fromPostgres('relation "x" does not exist')
  assert.equal(unknown.code, 'SERVER_ERROR')
  assert.equal(unknown.message, appErrors.SERVER_ERROR.message)
  assert.equal(unknown.detail, 'relation "x" does not exist')
  assert.equal(unknown.status, 503)
  assert.equal(unknown.retryable, true)
})

test('reverting steps back exactly one stage, never to submitted nor from cancelled', () => {
  // Que estos pares coincidan con la tabla order_status_transitions lo verifica
  // supabase/tests/orders.integration.mjs contra la base.
  assert.deepEqual(
    Object.entries(posActions).flatMap(([from, { revert }]) => (revert ? [`${from} -> ${revert.to}`] : [])),
    ['in_preparation -> accepted', 'ready -> in_preparation', 'delivered -> ready'],
  )
})

test('the error catalog decides which failures keep a submission for retry', () => {
  // Rechazos definitivos: liberan el envío para que el comensal revise el carrito.
  for (const code of ['PRICE_CHANGED', 'SESSION_CLOSED', 'IDEMPOTENCY_CONFLICT', 'REQUEST_ABANDONED']) {
    assert.equal(isRetryableError(code), false, code)
  }
  // Fallas transitorias y códigos desconocidos (red caída): el envío se conserva.
  for (const code of ['POS_UNAVAILABLE', 'SERVER_ERROR', 'AUTH_REQUIRED', 'CONNECTION_ERROR']) {
    assert.equal(isRetryableError(code), true, code)
  }
  assert.equal(appErrorMessage('STALE_DATA', 'fallback'), appErrors.STALE_DATA.message)
  assert.equal(appErrorMessage('P0001: INVALID_TRANSITION', 'fallback'), 'fallback')
})

test('table map states follow operational priority without inventing occupancy', () => {
  const orders = (...statuses: OrderStatus[]) => statuses.map((status) => ({ status }))
  assert.equal(getPosTableState(null), 'free')
  assert.equal(getPosTableState({ bill_requested_at: '2026-09-18' }), 'bill_requested')
  assert.equal(getPosTableState({}), 'occupied')
  assert.equal(getPosTableState({ orders: orders('delivered') }), 'occupied')
  assert.equal(getPosTableState({ orders: orders('accepted') }), 'order_pending')
  assert.equal(getPosTableState({ orders: orders('in_preparation') }), 'in_preparation')
  assert.equal(getPosTableState({ orders: orders('submitted', 'ready') }), 'ready')
  assert.equal(getPosTableState({
    orders: orders('ready'),
    bill_requested_at: '2026-09-18T12:00:00Z',
  }), 'bill_requested')
  assert.equal(getPosTableState({
    bill_requested_at: '2026-09-18T12:00:00Z',
    payments: [{ status: 'pending' }],
  }), 'payment_pending')
  // Llamar al mozo para que cobre manda a alguien a la mesa; un pago electrónico
  // a medio confirmar, no. Por eso son dos estados y ese va primero.
  assert.equal(getPosTableState({
    in_person_payment_requested_at: '2026-09-18T12:00:00Z',
    payments: [{ status: 'pending' }],
    orders: orders('ready'),
  }), 'in_person_payment')
})

test('a table waits with the requests it made, oldest first', () => {
  assert.deepEqual(sessionRequestsOf(null), [])
  assert.deepEqual(sessionRequestsOf({ bill_requested_at: null }), [])
  assert.deepEqual(
    sessionRequestsOf({
      bill_requested_at: '2026-09-18T12:05:00Z',
      in_person_payment_requested_at: '2026-09-18T12:00:00Z',
    }),
    [
      { kind: 'in_person_payment', requestedAt: '2026-09-18T12:00:00Z' },
      { kind: 'bill', requestedAt: '2026-09-18T12:05:00Z' },
    ],
  )
  // Cada tipo tiene rótulo propio: el plano no puede mostrar una clave cruda.
  for (const kind of sessionRequestKinds) assert.ok(sessionRequestLabels[kind])
})

test('a diner reads, per request, whether nobody asked, they wait, or they were attended', () => {
  const empty = {}
  assert.deepEqual(sessionRequestState(empty, 'bill'), { status: 'idle' })
  assert.deepEqual(
    sessionRequestState({ in_person_payment_requested_at: '2026-09-20T12:00:00Z' }, 'in_person_payment'),
    { status: 'waiting', since: '2026-09-20T12:00:00Z' },
  )
  // Atender no borra el aviso: lo convierte en la confirmación que responde
  // «¿ya está, me puedo ir?», y sobrevive a recargar o cambiar de pantalla.
  assert.deepEqual(
    sessionRequestState({ in_person_payment_attended_at: '2026-09-20T12:09:00Z' }, 'in_person_payment'),
    { status: 'attended', at: '2026-09-20T12:09:00Z' },
  )
  // Los tipos no se pisan entre sí.
  assert.deepEqual(sessionRequestState({ bill_attended_at: '2026-09-20T12:09:00Z' }, 'in_person_payment'), {
    status: 'idle',
  })
  // Si la base quedara con las dos fechas manda la espera: es la que pide acción.
  assert.deepEqual(
    sessionRequestState(
      { bill_requested_at: '2026-09-20T12:10:00Z', bill_attended_at: '2026-09-20T12:00:00Z' },
      'bill',
    ),
    { status: 'waiting', since: '2026-09-20T12:10:00Z' },
  )
  // Una mesa ya atendida no le queda al salón como pendiente.
  assert.deepEqual(sessionRequestsOf({ bill_attended_at: '2026-09-20T12:09:00Z' }), [])
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

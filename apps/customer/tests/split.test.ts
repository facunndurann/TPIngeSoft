import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  allocationTotal,
  billedOrderStatuses,
  defaultSessionSplit,
  isBilledStatus,
  parseSessionSplit,
  sessionSplitSchema,
  splitBill,
  splitEqualAmounts,
  type SessionSplit,
  type SplitOrder,
} from '@restaurant-platform/shared'

const ana = '11111111-1111-4111-8111-111111111111'
const beto = '22222222-2222-4222-8222-222222222222'
const caro = '33333333-3333-4333-8333-333333333333'
const participants = [{ id: ana }, { id: beto }, { id: caro }]

const item = (total: number, participantId: string | null, isShared = false) => ({
  is_shared: isShared,
  participant_id: participantId,
  total_price: total,
})

const order = (status: SplitOrder['status'], items: SplitOrder['order_items']): SplitOrder => ({
  status,
  order_items: items,
})

const amounts = (shares: ReturnType<typeof splitBill>) => shares.map((share) => share.amount)
const split = (type: SessionSplit['type'], allocations = {}): SessionSplit => ({
  type,
  allocations,
  ...(type === 'equal' ? { equalParts: 3 } : {}),
})

test('los estados facturables son exactamente los de la vista session_bills', () => {
  assert.deepEqual([...billedOrderStatuses], ['accepted', 'in_preparation', 'ready', 'delivered'])
  assert.equal(isBilledStatus('submitted'), false)
  assert.equal(isBilledStatus('cancelled'), false)
  assert.equal(isBilledStatus('delivered'), true)
})

test('none reparte lo propio más la parte compartida', () => {
  const orders = [
    order('delivered', [item(300, ana), item(100, beto), item(60, null, true)]),
    // Enviado y cancelado no están en cuenta: la vista tampoco los suma.
    order('submitted', [item(999, caro)]),
    order('cancelled', [item(999, caro)]),
  ]
  // 300 + 100 + 60 = 460 de pendiente; lo compartido son 20 por cabeza.
  assert.deepEqual(amounts(splitBill({ pending_amount: 460 }, orders, participants, split('none'))), [
    320, 120, 20,
  ])
})

test('none cae en reparto parejo cuando todavía nadie pidió', () => {
  const shares = splitBill({ pending_amount: 90 }, [], participants, split('none'))
  assert.deepEqual(amounts(shares), [30, 30, 30])
})

test('un ítem de alguien que ya no está en la mesa se reparte entre todos', () => {
  const ausente = '44444444-4444-4444-8444-444444444444'
  const orders = [order('accepted', [item(300, ausente), item(300, ana)])]
  assert.deepEqual(amounts(splitBill({ pending_amount: 600 }, orders, participants, split('none'))), [
    400, 100, 100,
  ])
})

test('todos los modos reparten la misma base: el pendiente', () => {
  const orders = [order('delivered', [item(700, ana), item(200, beto), item(100, caro)])]
  // La cuenta es 1000 pero ya se pagaron 400: los tres modos reparten 600.
  const bill = { pending_amount: 600 }
  for (const mode of [
    split('none'),
    split('equal'),
    split('percentages', { [ana]: 70, [beto]: 20, [caro]: 10 }),
  ]) {
    const total = splitBill(bill, orders, participants, mode).reduce((sum, s) => sum + s.amount, 0)
    assert.equal(total, 600, `modo ${mode.type}`)
  }
})

test('el reparto cierra exacto aunque no sea divisible', () => {
  // 100 / 3 daría 33,33 tres veces y perdería un centavo.
  const shares = splitBill({ pending_amount: 100 }, [], participants, split('equal'))
  assert.deepEqual(amounts(shares), [33.34, 33.33, 33.33])
  assert.equal(
    shares.reduce((sum, share) => sum + share.amountCents, 0),
    10000,
  )
})

test('las partes iguales usan la cantidad elegida, aunque no coincida con los conectados', () => {
  assert.deepEqual(splitEqualAmounts({ pending_amount: 100 }, 4), [25, 25, 25, 25])
  assert.deepEqual(splitEqualAmounts({ pending_amount: 100 }, 6), [16.67, 16.67, 16.67, 16.67, 16.66, 16.66])
})

test('un comensal que se sumó después no tiene porcentaje y paga 0', () => {
  const shares = splitBill(
    { pending_amount: 500 },
    [],
    participants,
    split('percentages', { [ana]: 50, [beto]: 50 }),
  )
  assert.deepEqual(amounts(shares), [250, 250, 0])
})

test('sin pendiente nadie debe nada, y sin comensales no hay reparto', () => {
  assert.deepEqual(amounts(splitBill({ pending_amount: 0 }, [], participants, split('equal'))), [
    0, 0, 0,
  ])
  assert.deepEqual(splitBill({ pending_amount: 500 }, [], [], split('equal')), [])
})

test('importes numeric de Postgres llegan como string', () => {
  const orders = [order('delivered', [item('120.50' as unknown as number, ana)])]
  const shares = splitBill({ pending_amount: '120.50' }, orders, participants, split('none'))
  assert.deepEqual(amounts(shares), [120.5, 0, 0])
})

test('el schema exige que los porcentajes sumen 100', () => {
  assert.equal(sessionSplitSchema.safeParse(split('percentages', { [ana]: 100 })).success, true)
  assert.equal(sessionSplitSchema.safeParse(split('percentages', { [ana]: 99 })).success, false)
  assert.equal(
    sessionSplitSchema.safeParse(split('percentages', { [ana]: 33.33, [beto]: 33.33, [caro]: 33.34 }))
      .success,
    true,
  )
  // Tres decimales no se pueden guardar sin perder precisión en el reparto.
  assert.equal(sessionSplitSchema.safeParse(split('percentages', { [ana]: 100.001 })).success, false)
})

test('solo percentages admite asignaciones', () => {
  assert.equal(sessionSplitSchema.safeParse(split('none', { [ana]: 100 })).success, false)
  assert.equal(sessionSplitSchema.safeParse(split('equal')).success, true)
  assert.equal(sessionSplitSchema.safeParse({ type: 'equal', allocations: {} }).success, false)
  assert.equal(sessionSplitSchema.safeParse({ ...split('equal'), equalParts: 1 }).success, false)
})

test('parseSessionSplit no castea: lo inválido vuelve a none', () => {
  assert.deepEqual(parseSessionSplit('equal', {}, 4), { type: 'equal', allocations: {}, equalParts: 4 })
  assert.deepEqual(parseSessionSplit('percentages', { [ana]: 100 }), {
    type: 'percentages',
    allocations: { [ana]: 100 },
  })
  assert.deepEqual(parseSessionSplit('mitades', {}), defaultSessionSplit)
  assert.deepEqual(parseSessionSplit('percentages', { [ana]: 40 }), defaultSessionSplit)
  assert.deepEqual(parseSessionSplit('none', null), defaultSessionSplit)
})

test('allocationTotal informa cuánto falta asignar', () => {
  assert.equal(allocationTotal({ [ana]: 40, [beto]: 35 }), 75)
  assert.equal(allocationTotal({}), 0)
})

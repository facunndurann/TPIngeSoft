import { test } from 'vitest'
import assert from 'node:assert/strict'
import { defaultSessionSplit, type SessionSplit } from '@restaurant-platform/shared'
import { paymentPlan } from '../src/features/mobile-payment'
import type { PayableItem, Payment, PaymentPlanInput } from '../src/features/mobile-payment'

const ana = '11111111-1111-4111-8111-111111111111'
const beto = '22222222-2222-4222-8222-222222222222'

const item = (id: string, total_price: number): PayableItem => ({
  id,
  product_name: 'Milanesa',
  quantity: 1,
  total_price,
  participant_id: ana,
  is_shared: false,
})

const payment = (overrides: Partial<Payment>): Payment => ({
  id: 'pago',
  participant_id: beto,
  amount: 0,
  method: 'mobile',
  mode: 'full',
  status: 'approved',
  payment_order_items: [],
  ...overrides,
})

/** Ana en una mesa con Beto: dos platos en cuenta, nada pagado y nada elegido. */
const table = (overrides: Partial<PaymentPlanInput> = {}): PaymentPlanInput => ({
  participantId: ana,
  participants: [{ id: ana }, { id: beto }],
  split: defaultSessionSplit,
  pending: 100,
  accountTotal: 100,
  closed: false,
  orders: [{ status: 'accepted', order_items: [item('a', 60), item('b', 40)] }],
  payments: [],
  selected: new Set(),
  ...overrides,
})

test('without chosen items or a split, the diner is offered the whole balance', () => {
  const plan = paymentPlan(table())
  assert.deepEqual(plan.share, { mode: 'full', amount: 100 })
  assert.deepEqual(plan.step, { kind: 'payable', request: { mode: 'full' } })

  // Sin saldo o con la mesa cerrada no hay nada que ofrecer.
  assert.deepEqual(paymentPlan(table({ pending: 0 })).step, { kind: 'nothing' })
  assert.deepEqual(paymentPlan(table({ closed: true })).step, { kind: 'nothing' })
})

test('chosen items are paid on their own, win over the split and cannot exceed the balance', () => {
  const equal: SessionSplit = { type: 'equal', allocations: {}, equalParts: 2 }
  const plan = paymentPlan(table({ split: equal, selected: new Set(['a']) }))
  assert.deepEqual(plan.share, { mode: 'custom', itemIds: ['a'], amount: 60 })
  assert.deepEqual(plan.step, { kind: 'payable', request: { mode: 'custom', itemIds: ['a'] } })

  assert.deepEqual(paymentPlan(table({ pending: 50, selected: new Set(['a']) })).step, { kind: 'exceeds', balance: 50 })

  // En centavos: sumado en float, 0.1 + 0.2 supera a 0.3 y el pago quedaba trabado.
  const cents = paymentPlan(
    table({
      pending: 0.3,
      orders: [{ status: 'accepted', order_items: [item('a', 0.1), item('b', 0.2)] }],
      selected: new Set(['a', 'b']),
    }),
  )
  assert.equal(cents.share.amount, 0.3)
  assert.equal(cents.step.kind, 'payable')
})

test('only billed items are listed, and those in a live payment cannot be chosen again', () => {
  const plan = paymentPlan(
    table({
      orders: [
        { status: 'accepted', order_items: [item('a', 60), item('b', 40)] },
        { status: 'submitted', order_items: [item('c', 10)] },
      ],
      payments: [
        payment({ status: 'approved', payment_order_items: [{ order_item_id: 'a' }] }),
        // Un pago rechazado libera sus ítems.
        payment({ status: 'rejected', payment_order_items: [{ order_item_id: 'b' }] }),
      ],
      selected: new Set(['a', 'b']),
    }),
  )

  assert.deepEqual(
    plan.items.map((row) => [row.item.id, row.coverage, row.selected]),
    [
      ['a', 'approved', false],
      ['b', undefined, true],
    ],
  )
  assert.deepEqual(plan.share, { mode: 'custom', itemIds: ['b'], amount: 40 })
})

test('equal parts offer a free part and hold back what pending payments reserved', () => {
  const split = (equalParts: number): SessionSplit => ({ type: 'equal', allocations: {}, equalParts })
  const payments = [
    payment({ mode: 'equal_split', status: 'approved', amount: 30 }),
    payment({ mode: 'equal_split', status: 'pending', amount: 30 }),
  ]

  // Cuatro partes, dos tomadas: los 30 reservados no se ofrecen y quedan 60 para dos partes.
  const plan = paymentPlan(table({ split: split(4), pending: 90, payments }))
  assert.deepEqual(plan.share, { mode: 'equal_split', remainingParts: 2, amount: 30 })
  assert.deepEqual(plan.step, { kind: 'payable', request: { mode: 'equal_split' } })

  // La última parte libre se lleva todo lo disponible.
  assert.equal(paymentPlan(table({ split: split(3), pending: 90, payments })).share.amount, 60)

  // Todo lo que falta ya está reservado por un pago esperando confirmación.
  assert.deepEqual(paymentPlan(table({ split: split(2), pending: 30, payments })).step, { kind: 'partsReserved' })
})

test('a percentage is taken from the account total, minus what the diner already paid', () => {
  const split: SessionSplit = { type: 'percentages', allocations: { [ana]: 40, [beto]: 60 } }
  const paid = (...amounts: number[]) =>
    amounts.map((amount) => payment({ participant_id: ana, mode: 'percentage_split', amount }))

  const plan = paymentPlan(table({ split, pending: 75, payments: paid(25) }))
  assert.deepEqual(plan.share, {
    mode: 'percentage_split',
    percentage: 40,
    accountTotal: 100,
    shareOfTotal: 40,
    amount: 15,
  })
  assert.deepEqual(plan.step, { kind: 'payable', request: { mode: 'percentage_split' } })

  // Nunca más que el saldo de la mesa.
  assert.equal(paymentPlan(table({ split, pending: 10 })).share.amount, 10)

  // 0.7 + 0.1 en float queda apenas debajo de 0.8: en centavos, ya pagó su parte.
  assert.deepEqual(paymentPlan(table({ split, accountTotal: 2, pending: 1.2, payments: paid(0.7, 0.1) })).step, {
    kind: 'sharePaid',
    percentage: 40,
  })
})

test('a payment of this diner waiting for the provider blocks everything else', () => {
  const own = payment({ id: 'mio', participant_id: ana, status: 'pending', amount: 60 })
  assert.deepEqual(paymentPlan(table({ payments: [own] })).step, { kind: 'pending', payment: own })
  assert.deepEqual(paymentPlan(table({ payments: [own], closed: true })).step, {
    kind: 'pending',
    payment: own,
  })

  // El pago pendiente de otro comensal no traba el de Ana.
  const others = payment({ status: 'pending', amount: 60 })
  assert.equal(paymentPlan(table({ payments: [others] })).step.kind, 'payable')
})

test('all pending payment modes reserve the balance offered by full and percentage payments', () => {
  const payments = [payment({ status: 'pending', amount: 75, mode: 'custom' })]
  assert.equal(paymentPlan(table({ payments })).share.amount, 25)
  const split: SessionSplit = { type: 'percentages', allocations: { [ana]: 40, [beto]: 60 } }
  assert.equal(paymentPlan(table({ payments, split })).share.amount, 25)
  assert.deepEqual(paymentPlan(table({ payments, selected: new Set(['a']) })).step, { kind: 'exceeds', balance: 25 })
  // Un saldo totalmente reservado no significa que Ana ya pagó su porcentaje.
  assert.deepEqual(paymentPlan(table({ payments: [payment({ status: 'pending', amount: 100 })], split })).step, {
    kind: 'nothing',
  })
})

test('a percentage deducts only net approved credit after a partial refund', () => {
  const split: SessionSplit = { type: 'percentages', allocations: { [ana]: 40, [beto]: 60 } }
  const payments = [payment({ participant_id: ana, amount: 40, refunded_amount: 15 })]
  const plan = paymentPlan(table({ split, payments, pending: 75 }))
  assert.equal(plan.share.amount, 15)
  assert.equal(plan.step.kind, 'payable')
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { orderAuthorName, sessionPlaceLabel, submitOrderSchema } from '../src/orders.ts'

test('an account is named by its table, or as takeout when it has none', () => {
  assert.equal(sessionPlaceLabel({ kind: 'table', tables: { label: 'Mesa 4' } }), 'Mesa 4')
  assert.equal(sessionPlaceLabel({ kind: 'takeout', tables: null }), 'Para llevar')
  // Una cuenta de mesa cuya mesa no llegó en la consulta no se hace pasar por takeout.
  assert.equal(sessionPlaceLabel({ kind: 'table', tables: null }), 'Mesa')
})

test('the order author comes from what the order saved, per origin', () => {
  const participants = [
    { id: 'p1', display_name: 'Ana' },
    { id: 'p2', display_name: 'Beto' },
  ]
  assert.equal(orderAuthorName({ origin: 'qr', submitted_by: 'p2', staff_author_name: null }, participants), 'Beto')
  assert.equal(orderAuthorName({ origin: 'pos', submitted_by: null, staff_author_name: 'Cajera Uno' }, participants), 'Cajera Uno')
  // Participante borrado (submitted_by nulo) o cuenta de personal sin nombre: autor desconocido, sin adivinar.
  assert.equal(orderAuthorName({ origin: 'qr', submitted_by: null, staff_author_name: null }, participants), 'Comensal')
  assert.equal(orderAuthorName({ origin: 'pos', submitted_by: null, staff_author_name: null }, participants), 'Personal')
})

test('the order schema rejects forged amounts, attribution, invalid quantities and duplicate selections', () => {
  const input = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000002',
    items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 2, optionIds: [], removedIds: [], isShared: false }],
    expectedTotal: 20.2,
  }
  assert.equal(submitOrderSchema.safeParse(input).success, true)
  for (const value of [NaN, Infinity, -1, .001, 100000000]) assert.equal(submitOrderSchema.safeParse({ ...input, expectedTotal: value }).success, false)
  for (const quantity of [0, 1.5, 100, '2']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity }] }).success, false)
  for (const field of ['optionIds', 'removedIds']) assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], [field]: [input.sessionId, input.sessionId] }] }).success, false)
  // El precio y el comensal los resuelve Postgres: el cliente no los puede mandar.
  assert.equal(submitOrderSchema.safeParse({ ...input, participantId: input.sessionId }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [{ ...input.items[0], basePrice: 0 }] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: [] }).success, false)
  assert.equal(submitOrderSchema.safeParse({ ...input, items: Array(51).fill(input.items[0]) }).success, false)
})

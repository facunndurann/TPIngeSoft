import { test } from 'vitest'
import assert from 'node:assert/strict'
import { orderAuthorName, sessionPlaceLabel } from '../src/orders.ts'

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

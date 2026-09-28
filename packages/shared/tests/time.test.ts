import { test } from 'vitest'
import assert from 'node:assert/strict'
import { formatElapsed, localDateKey } from '../src/time.ts'

test('the restaurant day changes at Argentina midnight, matching orders.local_date', () => {
  // 03:00 UTC es medianoche en Buenos Aires (UTC-3); pos.sql verifica el mismo borde en Postgres.
  assert.equal(localDateKey(new Date('2026-09-06T02:59:59.000Z')), '2026-09-05')
  assert.equal(localDateKey(new Date('2026-09-06T03:00:00.000Z')), '2026-09-06')
})

test('elapsed time reads naturally, in one vocabulary for both apps', () => {
  // Fragmento en minúscula, sin sujeto, que entra igual en «Actualizado …» que
  // en «Pediste la cuenta · …».
  const opened = '2026-09-05T12:00:00.000Z'
  const after = (ms: number) => Date.parse(opened) + ms
  assert.equal(formatElapsed(opened, after(30_000)), 'hace instantes')
  assert.equal(formatElapsed(opened, after(60_000)), 'hace 1 min')
  assert.equal(formatElapsed(opened, after(59 * 60_000)), 'hace 59 min')
  assert.equal(formatElapsed(opened, after(150 * 60_000)), 'hace 2 h')
  // Al salón le importan los minutos de la hora; al comensal, no.
  assert.equal(formatElapsed(opened, after(65 * 60_000), 'exact'), 'hace 1 h 5 min')
  assert.equal(formatElapsed(opened, after(65 * 60_000)), 'hace 1 h')
  assert.equal(formatElapsed(opened, after(120 * 60_000), 'exact'), 'hace 2 h')
  // Los milisegundos de react-query y el ISO de la base dan lo mismo.
  assert.equal(formatElapsed(Date.parse(opened), after(60_000)), 'hace 1 min')
  // Un reloj atrasado no puede producir un «hace -3 min».
  assert.equal(formatElapsed(opened, after(-5 * 60_000)), 'hace instantes')
})

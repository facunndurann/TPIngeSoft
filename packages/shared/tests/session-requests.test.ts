import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  sessionRequestKinds,
  sessionRequestLabels,
  sessionRequestsOf,
  sessionRequestState,
} from '../src/session-requests.ts'

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
  assert.deepEqual(sessionRequestState({}, 'bill'), { status: 'idle' })
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

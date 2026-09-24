import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { posPermissions } from '@restaurant-platform/shared'
import { auditActionLabel, auditActorLabel } from '../src/features/employees/audit'

const supervisor = { user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', full_name: 'Supervisor Esquina' }

test('audit labels a named employee actor', () => {
  assert.equal(
    auditActorLabel(
      { actor_user_id: supervisor.user_id, employee_id: null, user_id: null, details: {} },
      [supervisor],
    ),
    'Supervisor Esquina',
  )
})

test('audit labels an owner without profile as Administrador, never a UUID', () => {
  const ownerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  assert.equal(
    auditActorLabel(
      { actor_user_id: ownerId, employee_id: null, user_id: ownerId, details: { fullName: 'Supervisor Esquina' } },
      [supervisor],
    ),
    'Administrador',
  )
})

test('audit prefers stored actorName and ignores UUID leftovers', () => {
  assert.equal(
    auditActorLabel(
      { actor_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', employee_id: null, user_id: null, details: { actorName: 'Administrador' } },
      [],
    ),
    'Administrador',
  )
  assert.equal(
    auditActorLabel(
      { actor_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', employee_id: null, user_id: null, details: { actorName: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } },
      [],
    ),
    'Administrador',
  )
})

test('audit keeps historical PIN rows without inventing an account', () => {
  assert.equal(
    auditActorLabel(
      { actor_user_id: null, employee_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', user_id: null, details: {}, legacy_employee: { full_name: 'Ana (mozo)' } },
      [],
    ),
    'Ana (mozo)',
  )
})

const ana = { user_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', full_name: 'Ana Pérez' }
const action = (name: string, details: unknown = {}) => auditActionLabel({ action: name, details }, [ana])

test('audit actions read as sentences, with what each one stored', () => {
  assert.equal(action('account.created', { fullName: 'Ana Pérez' }), 'Creó la cuenta de Ana Pérez')
  // Restablecer contraseña guarda solo el id de la cuenta: el nombre sale de la lista.
  assert.equal(action('account.password_reset', { accountId: ana.user_id }), 'Restableció la contraseña de Ana Pérez')
  assert.equal(action('order.transition', { from: 'accepted', to: 'in_preparation' }), 'Pasó un pedido de «Recibido · en cuenta» a «En preparación»')
  assert.equal(action('session.moved', { sourceTableLabel: 'Mesa 1', destinationTableLabel: 'Mesa 4' }), 'Movió la comanda de Mesa 1 a Mesa 4')
  assert.equal(action('session.opened', { tableLabel: 'Mesa 2' }), 'Abrió Mesa 2')
  assert.equal(action('session.request_attended', { kind: 'bill' }), 'Atendió «Cuenta solicitada»')
  assert.match(action('payment.recorded', { amount: 4500, method: 'external' }), /^Registró un pago de \$\s?4\.500 \(Efectivo o pago externo\)$/)
  assert.equal(action('employee.deleted', { employeeName: 'Luis' }), 'Eliminó a Luis, empleado con PIN')
})

test('audit actions without their details still say what happened', () => {
  assert.equal(action('account.created'), 'Creó una cuenta')
  assert.equal(action('order.transition', { from: 'accepted', to: 'otro' }), 'Cambió el estado de un pedido')
  assert.equal(action('payment.recorded', { amount: '4500' }), 'Registró un pago')
  for (const details of [null, [], 'x']) assert.equal(action('session.moved', details), 'Movió una comanda de mesa')
  // Una acción nueva que todavía no tiene frase se ve con su código, no desaparece.
  assert.equal(action('kitchen.printed'), 'kitchen.printed')
  // Lo heredado de Object no cuenta como acción ni como estado conocido.
  assert.equal(action('toString'), 'toString')
  assert.equal(action('order.transition', { from: 'toString', to: 'ready' }), 'Cambió el estado de un pedido')
})

/**
 * Las acciones que escriben las migraciones: todo literal `'algo.accion'` que no
 * es un permiso (esos son `orders.*`, `sessions.*`…) ni un evento de
 * `integration_logs`. Si una migración suma una acción, este test pide su frase.
 */
test('every audit action written by the migrations has a readable label', () => {
  const integrationEvents = new Set(['order.submitted', 'order.status_changed'])
  const dir = new URL('../../../supabase/migrations/', import.meta.url)
  const written = new Set(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .flatMap((file) => [...fs.readFileSync(new URL(file, dir), 'utf8').matchAll(/'([a-z_]+\.[a-z_]+)'/g)])
      .map((match) => match[1])
      .filter((code) => !(posPermissions as readonly string[]).includes(code) && !integrationEvents.has(code)),
  )
  const unlabeled = [...written].filter((code) => action(code) === code)
  assert.ok(written.size >= 15, `se esperaban las acciones de auditoría, llegaron ${written.size}`)
  assert.deepEqual(unlabeled, [])
})

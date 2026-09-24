import { test } from 'vitest'
import assert from 'node:assert/strict'
import { auditActorLabel, auditSubject } from '../src/features/employees/audit'

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

test('audit subject reads only a stored string name', () => {
  assert.equal(auditSubject({ details: { fullName: 'Ana Pérez' } }), 'Ana Pérez')
  for (const details of [null, [], 'Ana', { fullName: 42 }]) assert.equal(auditSubject({ details }), null)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeUsername, employeeEmail, employeeRequestSchema, toggleRole } from '../../packages/shared/src/employees.ts'
import { appErrorBodySchema, appErrors } from '../../packages/shared/src/errors.ts'
import { createEmployeeHandler, type EmployeeGateway } from '../functions/employee-accounts/handler.ts'

const restaurantId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const input = { action: 'create', restaurantId, username: ' Ana.Perez ', fullName: 'Ana Pérez', password: 'correct horse battery', roles: ['waiter'], branchIds: [restaurantId], active: true }
function fixture(fail?: 'authorize' | 'save' | 'cleanup') {
  const calls: string[] = []
  const gateway: EmployeeGateway = {
    async authorize() { calls.push('authorize'); if (fail === 'authorize') throw new Error('FORBIDDEN') },
    async createAuth(email) { calls.push(email); return userId },
    async save() { calls.push('save'); if (fail === 'save' || fail === 'cleanup') throw new Error('duplicate key') },
    async deleteAuth(id) { calls.push(`delete:${id}`); if (fail === 'cleanup') throw new Error('network') },
    async resetPassword() { calls.push('reset') }, async auditReset(_input, completed) { calls.push(completed ? 'audit:completed' : 'audit:requested') },
  }
  const handler = createEmployeeHandler(async () => gateway, 'employees.example.com')
  const request = (body: unknown = input) => handler(new Request('http://local/employee-accounts', {
    method: 'POST', headers: { Authorization: 'Bearer verified-token' }, body: JSON.stringify(body),
  }))
  return { calls, request, handler }
}

test('username is globally normalized; display names are not login identifiers', () => {
  assert.equal(normalizeUsername(' Ana.Perez '), 'ana.perez')
  assert.equal(employeeEmail('ANA.PEREZ', 'employees.example.com'), 'ana.perez@employees.example.com')
  for (const value of ['ab', 'ana@other.com', 'éloise', 'a b', '.ana', 'ana.', 'a'.repeat(33)]) {
    assert.throws(() => normalizeUsername(value))
    assert.equal(employeeRequestSchema.safeParse({ ...input, username: value }).success, false)
  }
  // El schema normaliza igual que normalizeUsername: es lo que se guarda.
  const parsed = employeeRequestSchema.parse(input)
  assert.ok(parsed.action === 'create')
  assert.equal(parsed.username, 'ana.perez')
})
test('request rejects identity spoofing, ownership, invalid branches and weak passwords', () => {
  for (const extra of [{ actor: userId }, { employeeId: userId }, { userId }, { roles: ['owner'] },
    { roles: ['manager','waiter'] }, { branchIds: [] }, { password: '1234' }, { active: 'true' }]) {
    assert.equal(employeeRequestSchema.safeParse({ ...input, ...extra }).success, false)
  }
  // Cada acción lleva solo lo suyo: restablecer no cambia roles ni actualizar cambia la contraseña.
  assert.equal(employeeRequestSchema.safeParse({ action: 'reset-password', restaurantId, userId, password: input.password, roles: ['waiter'] }).success, false)
  const { username: _username, ...update } = input
  assert.equal(employeeRequestSchema.safeParse({ ...update, action: 'update', userId }).success, false)
})
test('manager is exclusive when toggling roles, matching what the request accepts', () => {
  assert.deepEqual(toggleRole(['waiter', 'cashier'], 'manager', true), ['manager'])
  assert.deepEqual(toggleRole(['manager'], 'waiter', true), ['waiter'])
  assert.deepEqual(toggleRole(['waiter'], 'cashier', true), ['waiter', 'cashier'])
  assert.deepEqual(toggleRole(['waiter', 'cashier'], 'waiter', false), ['cashier'])
  assert.deepEqual(toggleRole(['waiter'], 'waiter', true), ['waiter'])
})
test('authorization runs before any Auth mutation and answers with the catalog body', async () => {
  const f = fixture('authorize')
  const response = await f.request()
  assert.equal(response.status, appErrors.FORBIDDEN.status)
  assert.deepEqual(f.calls, ['authorize'])
  const body = appErrorBodySchema.parse(await response.json())
  assert.equal(body.error.code, 'FORBIDDEN')
})
test('a taken username keeps its own catalog code', async () => {
  const f = fixture('save')
  const body = appErrorBodySchema.parse(await (await f.request()).json())
  assert.deepEqual(body.error, { code: 'USERNAME_TAKEN', message: appErrors.USERNAME_TAKEN.message })
})
test('creation uses normalized internal email and then atomic membership save', async () => {
  const f = fixture()
  assert.equal((await f.request()).status, 201)
  assert.deepEqual(f.calls, ['authorize','ana.perez@employees.example.com','save'])
})
test('database collision compensates newly-created Auth user', async () => {
  const f = fixture('save')
  assert.equal((await f.request()).status, 409)
  assert.equal(f.calls.at(-1), `delete:${userId}`)
})
test('cleanup failure returns recoverable account reference', async () => {
  const f = fixture('cleanup')
  const response = await f.request()
  assert.equal(response.status, 500)
  assert.equal((await response.json()).reference, userId)
})
test('failed update must not delete existing global account', async () => {
  const f = fixture('save')
  const { username: _username, password: _password, ...update } = input
  await f.request({ ...update, action: 'update', userId })
  assert.deepEqual(f.calls, ['authorize','save'])
})
test('password reset is authorized and audited without email recovery', async () => {
  const f = fixture()
  assert.equal((await f.request({ action: 'reset-password', restaurantId, userId, password: input.password })).status, 200)
  assert.deepEqual(f.calls, ['authorize','audit:requested','reset','audit:completed'])
})
test('missing bearer token fails before authentication/mutation', async () => {
  const f = fixture()
  const response = await f.handler(new Request('http://local', { method: 'POST', body: '{}' }))
  assert.equal(response.status, 401)
  assert.deepEqual(f.calls, [])
})

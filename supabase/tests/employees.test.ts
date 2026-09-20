import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeUsername, employeeEmail, transitionPermission } from '../../packages/shared/src/employees.ts'
import { createEmployeeHandler, parseEmployeeRequest, type EmployeeGateway } from '../functions/employee-accounts/handler.ts'

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
  for (const value of ['ab', 'ana@other.com', 'éloise', 'a b', '.ana', 'ana.', 'a'.repeat(33)]) assert.throws(() => normalizeUsername(value))
  assert.equal(parseEmployeeRequest(input).fullName, parseEmployeeRequest({ ...input, username: 'other.user' }).fullName)
})
test('request rejects identity spoofing, ownership, invalid branches and weak passwords', () => {
  for (const extra of [{ actor: userId }, { employeeId: userId }, { userId }, { roles: ['owner'] },
    { roles: ['manager','waiter'] }, { branchIds: [] }, { password: '1234' }, { active: 'true' }]) {
    assert.throws(() => parseEmployeeRequest({ ...input, ...extra }))
  }
})
test('authorization runs before any Auth mutation', async () => {
  const f = fixture('authorize')
  assert.equal((await f.request()).status, 403)
  assert.deepEqual(f.calls, ['authorize'])
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
test('UI transition permissions distinguish kitchen, delivery, exceptional actions', () => {
  assert.equal(transitionPermission('accepted','in_preparation'), 'orders.prepare')
  assert.equal(transitionPermission('in_preparation','ready'), 'orders.prepare')
  assert.equal(transitionPermission('ready','delivered'), 'orders.deliver')
  assert.equal(transitionPermission('ready','in_preparation'), 'orders.revert')
  assert.equal(transitionPermission('ready','cancelled'), 'orders.cancel')
})

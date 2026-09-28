import { test } from 'vitest'
import assert from 'node:assert/strict'
import { auditDetailsSchema } from '../src/audit.ts'
import { isUuid } from '../src/schemas.ts'

test('audit details are read field by field: a bad field is dropped, the rest survives', () => {
  assert.deepEqual(
    auditDetailsSchema.parse({ tableLabel: 'Mesa 2', amount: '4500', from: 'toString', to: 'ready', extra: 1 }),
    { tableLabel: 'Mesa 2', amount: undefined, from: undefined, to: 'ready' },
  )
  assert.deepEqual(auditDetailsSchema.parse({ method: 'external', amount: 4500 }), { method: 'external', amount: 4500 })
})

test('details that are not even an object read as empty', () => {
  for (const details of [null, undefined, [], 'x', 42]) assert.deepEqual(auditDetailsSchema.parse(details), {})
})

test('a UUID is recognized in any case, and a name is not one', () => {
  assert.equal(isUuid('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true)
  assert.equal(isUuid('8A6E0804-2BD0-4672-B79D-D97027F9071A'), true)
  assert.equal(isUuid('Ana Pérez'), false)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { countLabel } from '../src/text.ts'

test('countLabel uses the singular only for exactly one, and takes irregular plurals', () => {
  assert.equal(countLabel(1, 'mesa'), '1 mesa')
  assert.equal(countLabel(0, 'mesa'), '0 mesas')
  assert.equal(countLabel(3, 'mesa operativa', 'mesas operativas'), '3 mesas operativas')
  assert.equal(countLabel(2, 'comensal', 'comensales'), '2 comensales')
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { relativeAge, oldestUpdate } from '../src/features/freshness'

const now = Date.parse('2026-09-20T12:00:00Z')
const ago = (ms: number) => now - ms

test('relativeAge describes the age of a reading in the diner language', () => {
  assert.equal(relativeAge(now, now), 'hace instantes')
  assert.equal(relativeAge(ago(59_000), now), 'hace instantes')
  assert.equal(relativeAge(ago(60_000), now), 'hace 1 min')
  assert.equal(relativeAge(ago(9 * 60_000 + 59_000), now), 'hace 9 min')
  assert.equal(relativeAge(ago(59 * 60_000), now), 'hace 59 min')
  assert.equal(relativeAge(ago(60 * 60_000), now), 'hace 1 h')
  assert.equal(relativeAge(ago(150 * 60_000), now), 'hace 2 h')

  // Un reloj atrasado no puede producir un "hace -3 min".
  assert.equal(relativeAge(now + 5 * 60_000, now), 'hace instantes')
})

test('oldestUpdate keeps the oldest reading and ignores the ones that never happened', () => {
  assert.equal(oldestUpdate(ago(60_000), ago(5_000)), ago(60_000))
  // `0` es "sin lectura" en react-query: no puede ganar por ser el menor.
  assert.equal(oldestUpdate(0, ago(5_000)), ago(5_000))
  assert.equal(oldestUpdate(0, 0), undefined)
  assert.equal(oldestUpdate(), undefined)
})

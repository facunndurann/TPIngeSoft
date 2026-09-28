import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  formatPrice,
  formatPriceDelta,
  fromCents,
  hasAtMostTwoDecimals,
  itemPriceCents,
  parseAmount,
  sumCents,
  toCents,
} from '../src/money.ts'

test('amounts become whole cents, whatever shape the database sends', () => {
  assert.equal(toCents(1.1), 110)
  assert.equal(toCents('2500.50'), 250050)
  assert.equal(toCents(null), 0)
  assert.equal(toCents('no es un número'), 0)
  assert.equal(fromCents(250050), 2500.5)
})

test('sums in cents do not drift like floats do', () => {
  assert.notEqual(0.1 + 0.2, 0.3)
  assert.equal(sumCents([0.1, 0.2]), 30)
  assert.equal(sumCents(['1000.10', 999.9, null]), 200000)
  assert.equal(itemPriceCents(0.1, [{ optionId: 'o', priceDelta: 0.2 }], 3), 90)
})

test('two decimals is what the database stores, checked on the number and not the text', () => {
  for (const value of [0, 1.1, 20.2, 33.34, 2500.5, 99999999.99, -5.25]) {
    assert.equal(hasAtMostTwoDecimals(value), true, String(value))
  }
  for (const value of [0.001, 1.005, 100.001, NaN, Infinity]) {
    assert.equal(hasAtMostTwoDecimals(value), false, String(value))
  }
  // El ruido de un cálculo en float viaja en el JSON con todos sus decimales.
  assert.equal(JSON.stringify(0.1 + 0.2), '0.30000000000000004')
  assert.equal(hasAtMostTwoDecimals(0.1 + 0.2), false)
})

test('a typed amount is a number from zero up with at most two decimals, or nothing yet', () => {
  assert.equal(parseAmount('0'), 0)
  assert.equal(parseAmount(' 1250.50 '), 1250.5)
  // Lo mismo que acepta la base: «1.100» es 1,1.
  assert.equal(parseAmount('1.100'), 1.1)
  for (const text of ['', '   ', '-5', 'gratis', '1.234', 'Infinity']) {
    assert.equal(parseAmount(text), null, JSON.stringify(text))
  }
})

test('what an option adds to a dish is said one way in every app: a plus sign, or «Sin cargo»', () => {
  assert.equal(formatPriceDelta(750), `+${formatPrice(750)}`)
  assert.equal(formatPriceDelta('350.25'), `+${formatPrice(350.25)}`)
  // Ni «Gratis» ni «$ 0»: la palabra que ya usaba la carta.
  assert.equal(formatPriceDelta(0), 'Sin cargo')
  assert.equal(formatPriceDelta('0.00'), 'Sin cargo')
})

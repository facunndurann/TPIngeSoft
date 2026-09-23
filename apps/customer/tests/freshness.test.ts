import { test } from 'vitest'
import assert from 'node:assert/strict'
import { oldestUpdate } from '../src/features/freshness'

const now = Date.parse('2026-09-20T12:00:00Z')
const ago = (ms: number) => now - ms

test('oldestUpdate keeps the oldest reading and ignores the ones that never happened', () => {
  assert.equal(oldestUpdate(ago(60_000), ago(5_000)), ago(60_000))
  // `0` es "sin lectura" en react-query: no puede ganar por ser el menor.
  assert.equal(oldestUpdate(0, ago(5_000)), ago(5_000))
  assert.equal(oldestUpdate(0, 0), undefined)
  assert.equal(oldestUpdate(), undefined)
})

test('the freshness note is text to read, not a live region that interrupts every poll', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { FreshnessNote } = await import('../src/components/FreshnessNote')

  const idle = renderToStaticMarkup(createElement(FreshnessNote, { label: 'la cuenta', updatedAt: Date.now(), isFetching: false }))
  const fetching = renderToStaticMarkup(createElement(FreshnessNote, { label: 'la cuenta', updatedAt: Date.now(), isFetching: true }))
  assert.match(idle, /Actualizado/)
  assert.match(fetching, /Actualizando la cuenta…/)
  for (const html of [idle, fetching]) assert.doesNotMatch(html, /role=|aria-live/)
  // Sin una lectura previa no hay antigüedad que mostrar.
  assert.equal(renderToStaticMarkup(createElement(FreshnessNote, { label: 'la cuenta', isFetching: true })), '')
})

test('a table time is the clock time, with the date only when it is not today', async () => {
  const { formatTableTime } = await import('@restaurant-platform/shared')
  const now = Date.parse('2026-09-22T23:30:00-03:00')
  assert.equal(formatTableTime('2026-09-22T22:52:00-03:00', now), '22:52')
  // El día es el del restaurante: 01:10 UTC del 23 todavía es el 22 en Buenos Aires.
  assert.equal(formatTableTime('2026-09-23T01:10:00Z', now), '22:10')
  assert.equal(formatTableTime('2026-09-21T23:58:00-03:00', now), '21/9 23:58')
})

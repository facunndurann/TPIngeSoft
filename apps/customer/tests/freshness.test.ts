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

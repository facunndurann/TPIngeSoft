// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ClockProvider, Elapsed } from '@restaurant-platform/ui'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  vi.useRealTimers()
})

test('a clock tick rewrites the elapsed text without redrawing the screen around it', () => {
  vi.useFakeTimers({ now: new Date('2026-09-27T20:00:00Z') })
  let screenRenders = 0
  function Screen() {
    screenRenders++
    return <p>Abierta <Elapsed since="2026-09-27T19:58:00Z" /></p>
  }

  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => root.render(<ClockProvider tickMs={60_000}><Screen /></ClockProvider>))
  assert.equal(container.textContent, 'Abierta hace 2 min')

  act(() => vi.advanceTimersByTime(60_000))

  // El texto envejeció y la pantalla que lo contiene no se volvió a dibujar.
  assert.equal(container.textContent, 'Abierta hace 3 min')
  assert.equal(screenRenders, 1)
  act(() => root.unmount())
})

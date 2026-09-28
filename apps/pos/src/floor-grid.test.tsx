import { test } from 'vitest'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloorGrid } from '@restaurant-platform/ui'

const table = { id: 'table-a', position_x: 0, position_y: 0, width: 1, height: 1, shape: 'square' }

/** La clase de la superficie del plano, que es la que decide qué hace un dedo sobre ella. */
function surfaceClass() {
  const html = renderToStaticMarkup(
    <FloorGrid
      tables={[table]}
      ariaLabel="Plano"
      emptyMessage="Vacío"
      renderTable={(entry) => <span key={entry.id} />}
    />,
  )
  return /class="([^"]*)"/.exec(html)![1]
}

test('a finger always pans the floor: the surface never keeps touch for itself', () => {
  // El editor del admin le pone `touch-none` a cada mesa, no a la grilla
  // (ver apps/admin/tests/floor-canvas.test.tsx).
  assert.match(surfaceClass(), /\btouch-manipulation\b/)
  assert.doesNotMatch(surfaceClass(), /\btouch-none\b/)
})

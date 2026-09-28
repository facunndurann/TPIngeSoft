import { test } from 'vitest'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloorGrid } from '@restaurant-platform/ui'

const table = { id: 'table-a', position_x: 0, position_y: 0, width: 1, height: 1, shape: 'square' }

/** La clase de la superficie del plano, que es la que decide qué hace un dedo sobre ella. */
function surfaceClass(editable?: boolean) {
  const html = renderToStaticMarkup(
    <FloorGrid
      tables={[table]}
      ariaLabel="Plano"
      emptyMessage="Vacío"
      editable={editable}
      renderTable={(entry) => <span key={entry.id} />}
    />,
  )
  return /class="([^"]*)"/.exec(html)![1]
}

test('the floor the POS operates lets a finger pan; only the editor keeps touch for dragging', () => {
  assert.match(surfaceClass(), /\btouch-manipulation\b/)
  assert.doesNotMatch(surfaceClass(), /\btouch-none\b/)
  assert.match(surfaceClass(true), /\btouch-none\b/)
})

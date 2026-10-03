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

test('the map grows to show every table, even one left of or above the usual area', () => {
  const far = { id: 'lejos', position_x: -3, position_y: 20, width: 2, height: 2, shape: 'rect' }
  const html = renderToStaticMarkup(
    <FloorGrid
      tables={[table, far]}
      ariaLabel="Plano"
      emptyMessage="Vacío"
      renderTable={(entry, tile) => <span key={entry.id} data-id={entry.id} style={tile.box} />}
    />,
  )
  // 3 columnas de más a la izquierda y la mesa de abajo, que termina en la fila 22.
  assert.match(html, /width:1188px;height:968px/)
  // Nada queda en coordenadas negativas: la de la izquierda arranca en el borde.
  assert.match(html, /data-id="lejos" style="left:3px;top:883px/)
  assert.match(html, /data-id="table-a" style="left:135px;top:3px/)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloorCanvas } from '../src/features/floor/FloorCanvas'
import type { FloorTable } from '../src/queries/floor'

const table = {
  id: 'table-a',
  label: 'Mesa 1',
  seats: 4,
  shape: 'square',
  position_x: 0,
  position_y: 0,
  width: 2,
  height: 2,
  is_active: true,
  is_visible: true,
} as FloorTable

/** El plano del sector con la mesa elegida: editable si recibe `editing`, de solo lectura si no. */
function render(editable: boolean) {
  const editing = { selectedId: table.id, onSelect: () => {}, onPlace: () => {} }
  return renderToStaticMarkup(<FloorCanvas tables={[table]} editing={editable ? editing : undefined} />)
}

/** Las clases del elemento cuya apertura cumple `pattern`. */
const classOf = (html: string, pattern: RegExp) => /class="([^"]*)"/.exec(pattern.exec(html)?.[0] ?? '')?.[1] ?? ''

test('the floor owns every touch gesture: one finger moves it, two pinch it', () => {
  // Sin bordes no hay scroll nativo que desplace: el recuadro toma los toques y
  // los traduce a la cámara, en los dos modos.
  for (const editable of [true, false]) {
    assert.match(classOf(render(editable), /<div data-floor-viewport="true" class="[^"]*"/), /\btouch-none\b/)
  }
})

test('editing, a finger that starts on a table or a handle drags it instead of the floor', () => {
  const html = render(true)

  // Lo que lleva `data-floor-item` no arrastra el plano: la mesa y sus manijas.
  assert.match(html, /<button[^>]*data-floor-item="true"[^>]*aria-label="Mesa 1,/)
  assert.match(classOf(html, /<button[^>]*aria-label="Mesa 1,[^"]*"[^>]*>/), /\btouch-none\b/)
  assert.match(classOf(html, /<span aria-hidden="true" class="[^"]*cursor-se-resize[^"]*"/), /\btouch-none\b/)
})

test('in view mode no table grabs the finger: anywhere it lands, it moves the floor', () => {
  assert.doesNotMatch(render(false), /data-floor-item/)
})

test('a table left of or above the origin is drawn there: the camera, not the floor, brings it into view', () => {
  const far = { ...table, id: 'table-far', label: 'Mesa lejos', position_x: -2, position_y: -1 } as FloorTable
  const html = renderToStaticMarkup(<FloorCanvas tables={[far]} />)
  // 44px por celda, y 3px de aire a cada lado entre mesas vecinas.
  assert.match(html, /style="left:-85px;top:-41px;width:82px;height:82px/)
})

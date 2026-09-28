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

/** El plano del sector con la mesa elegida: editable si recibe `onMove`, de solo lectura si no. */
function render(editable: boolean) {
  const noop = () => {}
  return renderToStaticMarkup(
    <FloorCanvas tables={[table]} selectedId={table.id} onSelect={noop} {...(editable ? { onMove: noop } : {})} />,
  )
}

/** Las clases del elemento cuya apertura cumple `pattern`. */
const classOf = (html: string, pattern: RegExp) => /class="([^"]*)"/.exec(pattern.exec(html)?.[0] ?? '')?.[1] ?? ''

test('editing, a finger that starts on a table drags it and one that starts on the empty grid pans the floor', () => {
  const html = render(true)

  // La superficie deja desplazar: con `touch-none` ahí, en una tablet no se llegaba
  // a la parte del plano que no entra en pantalla.
  assert.match(classOf(html, /<div class="relative [^"]*"/), /\btouch-manipulation\b/)
  // La mesa y su manija de tamaño se quedan con el gesto para arrastrarlas.
  assert.match(classOf(html, /<button[^>]*aria-label="Mesa 1,[^"]*"[^>]*>/), /\btouch-none\b/)
  assert.match(classOf(html, /<span aria-hidden="true" class="[^"]*cursor-se-resize[^"]*"/), /\btouch-none\b/)
})

test('in view mode no table blocks panning', () => {
  assert.doesNotMatch(render(false), /\btouch-none\b/)
})

import { test } from 'vitest'
import assert from 'node:assert/strict'
import { labelLayout } from '@restaurant-platform/ui'

/** La caja de una mesa de `w` × `h` celdas, en píxeles del plano: 44 por celda, menos 6 de aire. */
const box = (w: number, h: number) => ({ width: w * 44 - 6, height: h * 44 - 6 })
const mesa = { name: 'Mesa 1', detail: '4 lugares', compact: '4' }

test('whatever the zoom, a table’s text never reads smaller than 12px on screen', () => {
  for (let zoom = 0.3; zoom <= 1.5; zoom += 0.05) {
    const { nameSize, detailSize } = labelLayout(box(3, 3), zoom, mesa)
    assert.ok(nameSize * zoom >= 12 - 1e-9 && detailSize * zoom >= 12 - 1e-9, `zoom ${zoom.toFixed(2)}`)
  }
})

test('at full size, each table keeps the layout it had: seats below, beside on a bar, or as a number', () => {
  assert.deepEqual(labelLayout(box(3, 3), 1, mesa), { nameSize: 14, detailSize: 12, nameLines: 2, detail: 'below' })
  assert.equal(labelLayout(box(1, 1), 1, mesa).detail, 'compact')
  const bar = { name: 'Barra de apoyo', detail: 'fuera de uso', compact: null }
  assert.equal(labelLayout(box(8, 1), 1, bar).detail, 'beside')
})

test('zoomed out, what no longer fits is hidden instead of cut: only the name when nothing else fits', () => {
  // Al 30 %, «4 lugares» ya no entra en una mesa de 3 × 3: queda el número con su ícono.
  assert.equal(labelLayout(box(3, 3), 0.3, mesa).detail, 'compact')
  // Al 59 %, una mesa de una celda no tiene alto para dos renglones: solo el nombre.
  assert.equal(labelLayout(box(1, 1), 0.59, mesa).detail, 'none')
})

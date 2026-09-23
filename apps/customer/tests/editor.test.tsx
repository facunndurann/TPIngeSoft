// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Route } from 'react-router'
import { cartLock, type CartItem } from '../src/features/cart'
import { ProductEditor } from '../src/features/ProductEditor'
import { productPath } from '../src/features/table-paths'
import { TableProductPage } from '../src/pages/TablePage'
import { useCart } from '../src/stores/cart'
import { product, selection } from './fixtures'
import { cartKey, cleanupTables, renderTable, sessionId, token } from './table-harness'

// Sin red: la mesa de las pruebas sirve todo desde su caché.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  cleanupTables()
})

/** El plato de las pruebas de carta: una salsa obligatoria y un ingrediente que se puede quitar. */
async function renderEditor({ locked, dish = product }: { locked?: string; dish?: typeof product } = {}) {
  const saved: CartItem[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(<ProductEditor product={dish} locked={locked} onSave={(item) => saved.push(item)} onClose={() => {}} />)
  })

  const select = <T extends Element>(selector: string) => {
    const element = container.querySelector<T>(selector)
    assert.ok(element, `no hay ${selector}`)
    return element
  }
  const click = (selector: string) => act(async () => select<HTMLElement>(selector).click())
  return { container, saved, select, click }
}

test('the editor opens with nothing to fix, and whatever is checked goes in the dish', async () => {
  const { container, select } = await renderEditor()

  assert.equal(container.querySelector('.field-error'), null)
  assert.equal(container.querySelector('ul.notice'), null)
  // El ingrediente arranca marcado: está en el plato hasta que se lo destilda.
  assert.equal(select<HTMLInputElement>('#product-ingredients input').checked, true)
  // La salsa es de una sola opción: radios, con la regla y sin contador.
  assert.equal(container.querySelectorAll('#group-g input[type=radio]').length, 2)
  assert.equal(container.querySelectorAll('#group-g input[type=checkbox]').length, 0)
  assert.equal(select('#group-g-rule').textContent, 'Elegí 1')
  assert.equal(select<HTMLButtonElement>('.editor-submit button').disabled, false)
})

test('adding with a choice missing points at that group instead of doing nothing', async () => {
  const { container, saved, select, click } = await renderEditor()

  await click('.editor-submit button')
  assert.deepEqual(saved, [])
  assert.equal(select('#group-g-error').textContent, 'Elegí una opción.')
  assert.equal(document.activeElement?.id, 'group-g')
  assert.equal(select('#group-g').getAttribute('aria-describedby'), 'group-g-rule group-g-error')

  // El error se va apenas se corrige, sin volver a tocar el botón.
  const radios = container.querySelectorAll<HTMLInputElement>('#group-g input[type=radio]')
  await act(async () => radios[0].click())
  assert.equal(container.querySelector('#group-g-error'), null)
  // Otro radio del grupo reemplaza al anterior en vez de sumarse.
  await act(async () => radios[1].click())

  await click('#product-ingredients input')
  await click('.editor-submit button')
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].optionIds, ['o2'])
  assert.deepEqual(saved[0].removedIds, ['i'])
})

test('a locked table still shows the whole dish; only the button is off, and it says why', async () => {
  const locked = cartLock({ sessionOpen: false, closed: true, pending: false })
  const { container, select } = await renderEditor({ locked })

  const button = select<HTMLButtonElement>('.editor-submit button')
  assert.equal(button.disabled, true)
  assert.equal(select('#product-unavailable').textContent, locked)
  assert.equal(button.getAttribute('aria-describedby'), 'product-unavailable')
  // El plato se sigue leyendo y armando: ver precios y opciones no cuesta nada.
  const radio = select<HTMLInputElement>('#group-g input[type=radio]')
  await act(async () => radio.click())
  assert.equal(radio.checked, true)
  assert.equal(container.querySelector('.field-error'), null)
})

test('a dish that cannot be ordered says so next to the button from the start', async () => {
  const { select } = await renderEditor({ dish: { ...product, is_available: false } })

  assert.equal(select<HTMLButtonElement>('.editor-submit button').disabled, true)
  assert.equal(select('#product-unavailable').textContent, 'Este plato no está disponible.')
})

test('with a submission pending, opening a dish from the menu shows it instead of a dead end', async () => {
  useCart.getState().save(cartKey, { ...selection, id: 'line-1', productId: 'p' })
  useCart.getState().beginSubmission(cartKey, sessionId, 30.9)
  const container = await renderTable(productPath(token, 'p'), <Route path="producto/:productId" element={<TableProductPage />} />)

  assert.equal(container.querySelector('#product-title')?.textContent, 'Ñoquis')
  const button = container.querySelector<HTMLButtonElement>('.editor-submit button')
  assert.equal(button?.disabled, true)
  assert.match(container.querySelector('#product-unavailable')?.textContent ?? '', /^Tu último envío todavía necesita confirmación/)
  // Una sola vez, junto al botón: sin el aviso general de arriba repitiéndolo.
  assert.equal(container.textContent?.match(/necesita confirmación/g)?.length, 1)
})

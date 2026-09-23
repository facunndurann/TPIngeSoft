// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { CartItem } from '../src/features/cart'
import { ProductEditor } from '../src/features/ProductEditor'
import { product as fixture } from './fixtures'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** El plato de las pruebas de carta con lo que la pantalla lee: una salsa obligatoria y un ingrediente que se puede quitar. */
const product = { ...fixture, name: 'Ñoquis', media_urls: [], dietary_tags: [], food_info: null }

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

async function renderEditor() {
  const saved: CartItem[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(<ProductEditor product={product} onSave={(item) => saved.push(item)} onClose={() => {}} />)
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

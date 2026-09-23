// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Route } from 'react-router'
import { useNameGate } from '../src/features/name-gate'
import { NameModal } from '../src/features/NameModal'
import { productPath, tableRoot } from '../src/features/table-paths'
import type { RenameField } from '../src/hooks/useTableSession'
import { TableProductPage } from '../src/pages/TablePage'
import { useCart } from '../src/stores/cart'
import { cartKey, cleanupTables, pathnameIn, renderTable, settle, token } from './table-harness'

// Sin red: la mesa de las pruebas sirve todo desde su caché.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  cleanupTables()
})

async function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(node))
  return { container, rerender: (next: ReactNode) => act(async () => root.render(next)) }
}

const rename = (overrides: Partial<RenameField> = {}): RenameField => ({
  name: 'Ana',
  setName: () => {},
  editing: false,
  setEditing: () => {},
  submit: () => {},
  isPending: false,
  canSubmit: true,
  ...overrides,
})

test('with a name already chosen, the gate lets the action through on the spot', async () => {
  let gate!: ReturnType<typeof useNameGate>
  function Probe() {
    gate = useNameGate(true)
    return null
  }
  await render(<Probe />)

  let runs = 0
  await act(async () => gate.requireName(() => { runs += 1 }))
  assert.equal(runs, 1)
  assert.equal(gate.asking, false)
})

test('without a name, the action waits for it, runs once when saved and is dropped if declined', async () => {
  let gate!: ReturnType<typeof useNameGate>
  function Probe() {
    gate = useNameGate(false)
    return null
  }
  await render(<Probe />)

  let runs = 0
  await act(async () => gate.requireName(() => { runs += 1 }))
  assert.equal(runs, 0)
  assert.equal(gate.asking, true)
  await act(async () => gate.resolve())
  assert.equal(runs, 1)
  assert.equal(gate.asking, false)
  // Resuelta, no queda nada que repetir.
  await act(async () => gate.resolve())
  assert.equal(runs, 1)

  await act(async () => gate.requireName(() => { runs += 1 }))
  await act(async () => gate.cancel())
  assert.equal(gate.asking, false)
  assert.equal(runs, 1)
})

test('the name dialog can be declined, and focus goes back to the button that opened it', async () => {
  let cancels = 0
  const opener = document.createElement('button')
  document.body.append(opener)
  cleanups.push(() => opener.remove())
  opener.focus()

  const modal = <NameModal rename={rename()} canSave onSaved={() => {}} onCancel={() => { cancels += 1 }} />
  const { container, rerender } = await render(modal)
  const buttons = [...container.querySelectorAll('button')]
  const decline = buttons.find((button) => button.textContent === 'Ahora no')
  assert.ok(decline)

  await act(async () => decline.click())
  await act(async () => {
    container.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(cancels, 2)

  // Al cerrarse, el foco vuelve a quien lo abrió en vez de caer al principio de la página.
  await rerender(null)
  assert.equal(document.activeElement, opener)
})

test('saving the name continues with what the diner was doing', async () => {
  let saved = 0
  const submit = vi.fn((onSaved?: () => void) => onSaved?.())
  const { container } = await render(
    <NameModal rename={rename({ submit })} canSave onSaved={() => { saved += 1 }} onCancel={() => {}} />,
  )

  await act(async () => container.querySelector<HTMLButtonElement>('button.primary')?.click())
  assert.equal(submit.mock.calls.length, 1)
  assert.equal(saved, 1)
})

test('the first dish added waits for the name and goes into the cart once it is saved', async () => {
  const waiting: (() => void)[] = []
  const container = await renderTable(
    productPath(token, 'p'),
    <Route path="producto/:productId" element={<TableProductPage />} />,
    { requireName: (action) => waiting.push(action) },
  )

  // La salsa es obligatoria: se elige y se toca Agregar, como lo haría el comensal.
  await act(async () => container.querySelector<HTMLInputElement>('#group-g input[type=radio]')?.click())
  await act(async () => container.querySelector<HTMLButtonElement>('.editor-submit button')?.click())
  assert.equal(waiting.length, 1)
  assert.equal(useCart.getState().carts[cartKey], undefined, 'nothing is added before the name')

  await act(async () => waiting[0]())
  await settle()
  assert.equal(useCart.getState().carts[cartKey]?.length, 1)
  assert.equal(pathnameIn(container), tableRoot(token))
})

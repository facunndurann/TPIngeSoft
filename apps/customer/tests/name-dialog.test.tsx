// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TABLE_ROUTE } from '../src/features/table-paths'
import { TableRoute } from '../src/pages/TablePage'

// La mesa entera, sin red: la sesión es una mesa abierta con Ana, que todavía no
// eligió su nombre, y el pedido del nombre ya está abierto.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/features/name-gate', () => ({
  useNameGate: () => ({ asking: true, requireName: () => {}, resolve: () => {}, cancel: () => {} }),
}))
vi.mock('../src/hooks/useTableSession', () => {
  const ana = { id: 'participant-ana', user_id: 'user-1', display_name: 'Comensal', named_at: null }
  return {
    useTableSession: () => ({
      table: {
        isPending: false,
        isError: false,
        data: {
          restaurant: { name: 'La Parrilla', menu_design: 'oliva' },
          branch: { name: 'Centro', payment_methods: ['in_person'] },
          table: { label: 'Mesa 4' },
        },
      },
      menu: { data: undefined, isPending: true, isError: false },
      // Todavía conectando: el panel de la mesa se muestra y tiene contenido.
      joined: { isPending: true, isError: false, data: undefined },
      session: { data: { status: 'open', participants: [ana] }, isError: false },
      sessionId: 'session-1',
      refreshTable: async () => {},
      sessionOpen: true,
      me: ana,
      nameOf: () => 'Comensal',
      named: false,
      closed: false,
      rename: {
        name: '',
        setName: () => {},
        editing: false,
        setEditing: () => {},
        submit: () => {},
        isPending: false,
        canSubmit: false,
      },
    }),
  }
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

test('with the name dialog open, everything else on the table is inert, header and table panel included', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/m/mesa-4']}>
        <Routes>
          <Route path={TABLE_ROUTE} element={<TableRoute />}>
            <Route index element={null} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })

  const dialog = container.querySelector('[role="dialog"]')!
  assert.ok(dialog, 'The dialog is open')
  const outside = [
    container.querySelector('header'),
    container.querySelector('[aria-label="Tu mesa"]'),
    container.querySelector('nav[aria-label="Navegación"]'),
  ]
  for (const element of outside) {
    assert.ok(element, 'Each part of the table is on screen')
    assert.ok(element.closest('[inert]'), `${element.tagName} is inert behind the dialog`)
  }
  // El diálogo es lo único que queda vivo.
  assert.equal(dialog.closest('[inert]'), null)
})

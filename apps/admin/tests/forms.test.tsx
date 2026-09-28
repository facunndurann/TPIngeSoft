// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@restaurant-platform/ui'
import { EmployeesPage } from '../src/pages/EmployeesPage'
import { ModifiersPage } from '../src/pages/ModifiersPage'
import { branchesQuery } from '../src/queries/branches'
import {
  changeEmployee,
  employeeAuditQuery,
  employeesQuery,
  legacyEmployeesQuery,
  linkableAccountsQuery,
} from '../src/queries/employees'
import { modifierGroupsQuery, saveModifierGroup } from '../src/queries/modifier-groups'
import { RestaurantContext, type Membership } from '../src/restaurant/restaurant-context'

// Sin red: las páginas leen de una caché sembrada y las escrituras las decide cada prueba.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock(import('../src/queries/employees'), async (importOriginal) => ({
  ...(await importOriginal()),
  changeEmployee: vi.fn(),
}))
vi.mock(import('../src/queries/modifier-groups'), async (importOriginal) => ({
  ...(await importOriginal()),
  saveModifierGroup: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const restaurantId = 'restaurant-1'
const membership = { restaurant: { id: restaurantId, name: 'La Esquina' }, role: 'owner' } as Membership

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(changeEmployee).mockReset()
  vi.mocked(saveModifierGroup).mockReset()
})

async function renderPage(page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(employeesQuery(restaurantId).queryKey, [])
  client.setQueryData(employeeAuditQuery(restaurantId).queryKey, [])
  client.setQueryData(legacyEmployeesQuery(restaurantId).queryKey, [])
  client.setQueryData(linkableAccountsQuery(restaurantId).queryKey, [])
  client.setQueryData(branchesQuery(restaurantId).queryKey, [
    { id: 'branch-1', name: 'Centro', is_active: true },
  ] as never)
  client.setQueryData(modifierGroupsQuery(restaurantId).queryKey, [])

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RestaurantContext value={membership}>
            <MemoryRouter>{page}</MemoryRouter>
          </RestaurantContext>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  )
  return container
}

const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!

/** El input de un Field, por el texto de su rótulo. */
const fieldIn = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('label')]
    .find((element) => element.querySelector('span')?.textContent === label)!
    .querySelector('input')!

const describedText = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ')

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Deja correr la mutación, sus callbacks y los renders que disparan. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

const toastText = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="status"]')].map((region) => region.textContent).join(' ')

test('an employee without a branch is not saved: the reason sits on that group, which takes the focus', async () => {
  vi.mocked(changeEmployee).mockResolvedValue(undefined as never)
  const container = await renderPage(<EmployeesPage />)
  await act(async () => buttonIn(container, 'Agregar empleado').click())
  const dialog = container.querySelector('dialog')!

  // La regla de la contraseña se lee antes de equivocarse.
  assert.match(describedText(fieldIn(dialog, 'Contraseña inicial')), /Mínimo 10 caracteres/)

  await act(async () => {
    type(fieldIn(dialog, 'Nombre visible'), 'Ana Pérez')
    type(fieldIn(dialog, 'Usuario global'), 'ana.perez')
    type(fieldIn(dialog, 'Contraseña inicial'), 'una-clave-segura')
  })
  // «Guardar» no se apaga en silencio: se puede tocar, y dice qué falta.
  const save = buttonIn(dialog, 'Guardar')
  assert.equal(save.disabled, false)
  await act(async () => save.click())

  const branches = [...dialog.querySelectorAll('fieldset')].find((group) => /Sucursales/.test(group.textContent ?? ''))!
  assert.equal(document.activeElement, branches)
  assert.match(describedText(branches), /Elegí al menos una sucursal/)
  assert.equal(vi.mocked(changeEmployee).mock.calls.length, 0)

  await act(async () => branches.querySelector('input')!.click())
  await act(async () => buttonIn(dialog, 'Guardar').click())
  await settle()

  assert.equal(vi.mocked(changeEmployee).mock.calls.length, 1)
  assert.equal(container.querySelector('dialog'), null)
  assert.match(toastText(container), /Agregamos a Ana Pérez al equipo\./)
})

test('the modifier group editor marks each problem on its field, focuses the first, and confirms the save', async () => {
  vi.mocked(saveModifierGroup).mockResolvedValue(undefined as never)
  const container = await renderPage(<ModifiersPage />)
  await act(async () => buttonIn(container, 'Nuevo grupo').click())
  const dialog = container.querySelector('dialog')!

  await act(async () => buttonIn(dialog, 'Guardar grupo').click())

  const name = fieldIn(dialog, 'Nombre del grupo')
  assert.equal(document.activeElement, name)
  assert.equal(name.getAttribute('aria-invalid'), 'true')
  assert.match(describedText(name), /El grupo necesita un nombre/)
  // Sin opciones no hay campo: el motivo queda en el botón que las agrega.
  assert.match(describedText(buttonIn(dialog, 'Agregar opción')), /Agregá al menos una opción/)
  assert.equal(vi.mocked(saveModifierGroup).mock.calls.length, 0)

  // Corregido, deja de marcarse solo.
  await act(async () => type(name, 'Extras'))
  assert.equal(name.getAttribute('aria-invalid'), null)

  await act(async () => buttonIn(dialog, 'Agregar opción').click())
  await act(async () =>
    type(dialog.querySelector<HTMLInputElement>('[aria-label="Nombre de la opción 1"]')!, 'Cheddar'),
  )
  await act(async () => buttonIn(dialog, 'Guardar grupo').click())
  await settle()

  assert.equal(vi.mocked(saveModifierGroup).mock.calls.length, 1)
  assert.match(toastText(container), /Creamos el grupo «Extras»\./)
})

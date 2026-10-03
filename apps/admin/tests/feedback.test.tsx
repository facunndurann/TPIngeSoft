// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router'
import { ERROR_TOAST_MS, TOAST_MS, ToastProvider, useConfirm, useToast } from '@restaurant-platform/ui'
import { UnsavedChangesGuard } from '../src/features/UnsavedChangesGuard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.useRealTimers()
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
  return container
}

const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!

test('confirm asks with the panel dialog, starts on the safe option and answers what was chosen', async () => {
  const answers: boolean[] = []
  function Row() {
    const { confirm, dialog } = useConfirm()
    return (
      <>
        <button
          onClick={async () => answers.push(await confirm({ title: '¿Eliminar "Clásica"?', confirmLabel: 'Eliminar' }))}
        >
          Borrar
        </button>
        {dialog}
      </>
    )
  }
  const container = await render(<Row />)

  await act(async () => buttonIn(container, 'Borrar').click())
  const dialog = container.querySelector('dialog')!
  assert.match(dialog.textContent ?? '', /¿Eliminar "Clásica"\?/)
  // Un Enter apurado no borra: el foco arranca en cancelar.
  assert.equal(document.activeElement, buttonIn(dialog, 'Cancelar'))

  await act(async () => buttonIn(dialog, 'Cancelar').click())
  await act(async () => buttonIn(container, 'Borrar').click())
  await act(async () => buttonIn(container.querySelector('dialog')!, 'Eliminar').click())

  assert.deepEqual(answers, [false, true])
  assert.equal(container.querySelector('dialog'), null)
})

test('a success toast is announced, goes away on its own, and waits while the pointer is on it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let toast!: (message: string) => void
  function Probe() {
    toast = useToast()
    return null
  }
  const container = await render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  )
  const region = container.querySelector('[role="status"]')!

  await act(async () => toast('Guardamos el grupo «Extras».'))
  assert.match(region.textContent ?? '', /Guardamos el grupo «Extras»\./)

  // Con el puntero encima se queda; al irse, vuelve a contar.
  await act(async () => region.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  await act(async () => vi.advanceTimersByTime(TOAST_MS * 2))
  assert.match(region.textContent ?? '', /Extras/)

  await act(async () => region.querySelector('p')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  await act(async () => vi.advanceTimersByTime(TOAST_MS))
  assert.equal(region.textContent, '')
})

test('an error toast floats as an alert: it does not push the page, lasts longer and closes with its ×', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let toast!: ReturnType<typeof useToast>
  function Probe() {
    toast = useToast()
    return null
  }
  const container = await render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  )
  const alert = container.querySelector('[role="alert"]')!
  const status = container.querySelector('[role="status"]')!

  await act(async () => toast('No pudimos guardar el cambio.', { tone: 'error' }))
  assert.match(alert.textContent ?? '', /No pudimos guardar el cambio\./)
  assert.equal(status.textContent, '')
  // Flota encima de la página: no ocupa lugar en el flujo.
  assert.match(alert.parentElement!.className, /\bfixed\b/)

  // Pasado el tiempo de un aviso común sigue a la vista; se va al de un error.
  await act(async () => vi.advanceTimersByTime(TOAST_MS))
  assert.match(alert.textContent ?? '', /No pudimos/)
  await act(async () => vi.advanceTimersByTime(ERROR_TOAST_MS - TOAST_MS))
  assert.equal(alert.textContent, '')

  await act(async () => toast('Ahí se superpone con otra mesa.', { tone: 'error' }))
  await act(async () => alert.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]')!.click())
  assert.equal(alert.textContent, '')
})

/** Un formulario de página con el guard, como el de producto: editar, salir o guardar y volver a la lista. */
function Form() {
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()
  return (
    <>
      <UnsavedChangesGuard when={dirty && !saved} />
      <button onClick={() => setDirty(true)}>Editar</button>
      <Link to="/lista">Cancelar</Link>
      <button
        onClick={() => {
          flushSync(() => setSaved(true))
          navigate('/lista')
        }}
      >
        Guardar
      </button>
    </>
  )
}

async function renderForm() {
  const router = createMemoryRouter(
    [
      { path: '/form', element: <Form /> },
      { path: '/lista', element: <p>Lista</p> },
    ],
    { initialEntries: ['/form'] },
  )
  const container = await render(<RouterProvider router={router} />)
  const leave = () => act(async () => container.querySelector('a')!.click())
  return { container, router, leave }
}

test('leaving a form without changes needs no question', async () => {
  const { router, leave } = await renderForm()
  await leave()
  assert.equal(router.state.location.pathname, '/lista')
})

test('leaving with unsaved changes asks first: keep editing stays, discard leaves', async () => {
  const { container, router, leave } = await renderForm()
  await act(async () => buttonIn(container, 'Editar').click())

  await leave()
  const dialog = container.querySelector('dialog')!
  assert.match(dialog.textContent ?? '', /¿Descartar los cambios\?/)
  assert.equal(router.state.location.pathname, '/form')
  await act(async () => buttonIn(dialog, 'Seguir editando').click())
  assert.equal(router.state.location.pathname, '/form')
  assert.equal(container.querySelector('dialog'), null)

  await leave()
  await act(async () => buttonIn(container.querySelector('dialog')!, 'Descartar cambios').click())
  assert.equal(router.state.location.pathname, '/lista')
})

test('with unsaved changes the browser asks before reloading; saving and going back to the list does not ask', async () => {
  const { container, router } = await renderForm()
  await act(async () => buttonIn(container, 'Editar').click())

  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  assert.equal(unload.defaultPrevented, true)

  await act(async () => buttonIn(container, 'Guardar').click())
  assert.equal(router.state.location.pathname, '/lista')
  assert.equal(container.querySelector('dialog'), null)
})

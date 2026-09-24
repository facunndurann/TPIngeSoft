// @vitest-environment happy-dom
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Toast } from '../src/components/Toast'
import { TOAST_EXIT_ANIMATION } from '../src/features/announcements'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

async function renderToast(undo?: () => void) {
  let dismissed = 0
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => {
    root.render(<Toast announcement={{ id: 1, message: 'Clásica se quitó de tu carrito', undo }} onDismiss={() => { dismissed += 1 }} />)
  })
  const end = (target: Element, animationName: string) =>
    act(async () => { target.dispatchEvent(new AnimationEvent('animationend', { animationName, bubbles: true })) })
  return { container, dismissed: () => dismissed, end }
}

test('the toast closes when its own exit animation ends, so pausing that animation pauses the close', async () => {
  const { container, dismissed, end } = await renderToast(() => {})
  const toast = container.querySelector('.toast')
  const undo = container.querySelector('.toast-undo')
  assert.ok(toast && undo)

  // La entrada termina enseguida y no cierra nada.
  await end(toast, 'toastIn')
  // Tampoco una animación de algo de adentro que burbujea hasta el aviso.
  await end(undo, TOAST_EXIT_ANIMATION)
  assert.equal(dismissed(), 0)

  await end(toast, TOAST_EXIT_ANIMATION)
  assert.equal(dismissed(), 1)
})

test('undoing closes the toast right away', async () => {
  let undone = 0
  const { container, dismissed } = await renderToast(() => { undone += 1 })
  await act(async () => container.querySelector<HTMLButtonElement>('.toast-undo')?.click())
  assert.equal(undone, 1)
  assert.equal(dismissed(), 1)
})

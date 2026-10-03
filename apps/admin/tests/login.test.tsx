// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { authErrorMessage } from '../src/lib/auth-errors'
import { supabase } from '../src/lib/supabase'
import { LoginPage } from '../src/pages/LoginPage'

// Sin red: Auth responde lo que decide cada prueba.
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } },
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(supabase.auth.signUp).mockReset()
})

test('what Auth says in English reaches the panel in Spanish, and nothing unknown leaks through', () => {
  assert.equal(authErrorMessage({ code: 'invalid_credentials' }, 'login'), 'Email o contraseña incorrectos.')
  assert.match(authErrorMessage({ code: 'user_already_exists' }, 'signup'), /Ya existe una cuenta con ese email/)
  assert.match(authErrorMessage({ code: 'weak_password' }, 'signup'), /contraseña/)
  // Un código nuevo o ninguno: el genérico del modo, nunca el texto en inglés.
  assert.match(authErrorMessage({ code: 'something_new' }, 'signup'), /^No pudimos crear la cuenta/)
  assert.match(authErrorMessage({ code: undefined }, 'login'), /^No pudimos iniciar sesión/)
})

/** Pasa al alta, completa el formulario y lo envía; devuelve el contenedor. */
async function signUp(email: string, password: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(<LoginPage />))

  const toggle = [...container.querySelectorAll('button')].find((button) =>
    /Registrate/.test(button.textContent ?? ''),
  )!
  await act(async () => toggle.click())

  const [emailInput, passwordInput] = container.querySelectorAll('input')
  const type = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await act(async () => {
    type(emailInput, email)
    type(passwordInput, password)
  })
  await act(async () => container.querySelector('form')!.requestSubmit())
  return container
}

test('when the project asks to confirm the email, signing up says so and goes back to log in', async () => {
  vi.mocked(supabase.auth.signUp).mockResolvedValue({ data: { user: {}, session: null }, error: null } as never)

  const container = await signUp('duena@esquina.com', 'una-clave-larga')

  const notice = container.querySelector('[role="status"]')!.textContent ?? ''
  assert.match(notice, /Te mandamos un email a duena@esquina\.com/)
  // De vuelta al ingreso, con el email escrito y la contraseña vacía.
  assert.equal(container.querySelector('button[type="submit"]')?.textContent, 'Ingresar')
  const [emailInput, passwordInput] = container.querySelectorAll('input')
  assert.equal(emailInput.value, 'duena@esquina.com')
  assert.equal(passwordInput.value, '')
})

test('a rejected sign up shows its reason in Spanish', async () => {
  vi.mocked(supabase.auth.signUp).mockResolvedValue({
    data: { user: null, session: null },
    error: { code: 'user_already_exists', message: 'User already registered' },
  } as never)

  const container = await signUp('duena@esquina.com', 'una-clave-larga')

  const alert = container.querySelector('[role="alert"]')!.textContent ?? ''
  assert.match(alert, /Ya existe una cuenta con ese email/)
  assert.doesNotMatch(container.textContent ?? '', /User already registered/)
})

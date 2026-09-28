// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthError } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoginPage } from './pages/LoginPage'

// Sin red: Auth responde lo que decide cada prueba.
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn() } },
  employeeEmailDomain: 'employees.example.com',
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.mocked(supabase.auth.signInWithPassword).mockReset()
})

/** Completa el formulario y lo envía; devuelve el texto de la pantalla después. */
async function logIn(username: string, password: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(<LoginPage />))

  const [user, secret] = container.querySelectorAll('input')
  const type = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await act(async () => {
    type(user, username)
    type(secret, password)
  })
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  return container.textContent ?? ''
}

/** Lo que devuelve signInWithPassword cuando Auth rechaza el ingreso con ese código. */
const rejected = (code: string) =>
  ({ data: { user: null, session: null }, error: new AuthError('rechazado', 400, code) }) as never

test('wrong credentials are recognized by their code and sent to the employee domain', async () => {
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue(rejected('invalid_credentials'))

  const text = await logIn('Mozo.Uno', 'incorrecta')

  assert.match(text, /Usuario o contraseña incorrectos\./)
  assert.deepEqual(vi.mocked(supabase.auth.signInWithPassword).mock.calls, [
    [{ email: 'mozo.uno@employees.example.com', password: 'incorrecta' }],
  ])
})

test('any other rejection shows the generic message, not the provider detail', async () => {
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue(rejected('over_request_rate_limit'))

  const text = await logIn('mozo.uno', 'lo-que-sea')

  assert.match(text, /No pudimos iniciar sesión\. Intentá de nuevo/)
  assert.doesNotMatch(text, /rechazado/)
})

test('a malformed username is explained without reaching Auth', async () => {
  const text = await logIn('x', 'lo-que-sea')

  assert.match(text, /El usuario debe tener 3–32 caracteres/)
  assert.equal(vi.mocked(supabase.auth.signInWithPassword).mock.calls.length, 0)
})

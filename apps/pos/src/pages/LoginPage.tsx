import { useState, type FormEvent } from 'react'
import { employeeEmail } from '@restaurant-platform/shared'
import { Button, ErrorText, Field, Input } from '@restaurant-platform/ui'
import { supabase } from '@/lib/supabase'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const email = employeeEmail(username, import.meta.env.VITE_EMPLOYEE_EMAIL_DOMAIN ?? '')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        throw new Error(
          error.message === 'Invalid login credentials'
            ? 'Usuario o contraseña incorrectos.'
            : 'No pudimos iniciar sesión. Intentá de nuevo o pedí ayuda a tu administrador.',
        )
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'No pudimos iniciar sesión.') }
    finally { setBusy(false); setPassword('') }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Ingresar al POS</h1>
      <Field label="Usuario"><Input autoComplete="username" autoCapitalize="none" value={username} onChange={e => setUsername(e.target.value)} required autoFocus /></Field>
      <Field label="Contraseña"><Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
      <ErrorText message={error} />
      <Button className="w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</Button>
      <p className="text-sm text-neutral-500">Si olvidaste tu contraseña, pedí a tu administrador que la restablezca.</p>
    </form>
  </main>
}

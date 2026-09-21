import { useState, type FormEvent } from 'react'
import { UtensilsCrossed, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button, ErrorText, Field, Input } from '@restaurant-platform/ui'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: authError } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    if (authError) {
      setError(
        authError.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos'
          : authError.message,
      )
    }
    setSubmitting(false)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-indigo-600 p-3 text-white">
            {mode === 'login' ? <UtensilsCrossed size={22} /> : <Store size={22} />}
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Panel del restaurante</h1>
          <p className="text-sm text-neutral-500">
            {mode === 'login' ? 'Ingresá con tu cuenta' : 'Creá una cuenta para tu restaurante'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@turestaurante.com"
              required
            />
          </Field>
          <Field label="Contraseña">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Enviando…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </Button>
        </form>
        <button
          className="mt-4 w-full cursor-pointer text-center text-sm text-indigo-600 hover:underline"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Ingresá'}
        </button>
      </div>
    </main>
  )
}

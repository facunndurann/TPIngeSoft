import { useState, type FormEvent } from 'react'
import { MailCheck, UtensilsCrossed, Store } from 'lucide-react'
import { authErrorMessage, type AuthMode } from '@/lib/auth-errors'
import { supabase } from '@/lib/supabase'
import { Button, ErrorText, Field, Input } from '@restaurant-platform/ui'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [error, setError] = useState<string | null>(null)
  // A qué email mandamos la confirmación de la cuenta recién creada.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setConfirmationSentTo(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) setError(authErrorMessage(authError, mode))
        return
      }

      const { data, error: authError } = await supabase.auth.signUp({ email, password })
      if (authError) {
        setError(authErrorMessage(authError, mode))
      } else if (!data.session) {
        // El proyecto pide confirmar el email: la cuenta existe pero todavía no hay
        // sesión, y sin este aviso el alta parecía no haber hecho nada. Se vuelve al
        // ingreso con el email escrito, que es lo que sigue después del enlace.
        setConfirmationSentTo(email.trim())
        setMode('login')
        setPassword('')
      }
      // Con sesión, AuthProvider ya la tomó y la app sale del login sola.
    } catch {
      // Lo que ni siquiera llegó a Auth (sin red): el mensaje genérico del modo.
      setError(authErrorMessage({ code: undefined }, mode))
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'signup' : 'login')
    setError(null)
    setConfirmationSentTo(null)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <title>{mode === 'login' ? 'Ingresar · Panel del restaurante' : 'Crear cuenta · Panel del restaurante'}</title>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-primary p-3 text-white">
            {mode === 'login' ? <UtensilsCrossed size={22} /> : <Store size={22} />}
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Panel del restaurante</h1>
          <p className="text-sm text-muted">
            {mode === 'login' ? 'Ingresá con tu cuenta' : 'Creá una cuenta para tu restaurante'}
          </p>
        </div>
        {/* Siempre montado: un lector de pantalla anuncia el aviso cuando aparece. */}
        <div role="status">
          {confirmationSentTo && (
            <p className="mb-4 flex gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Te mandamos un email a <strong>{confirmationSentTo}</strong>. Abrí el enlace para confirmar la
                cuenta y después ingresá acá.
              </span>
            </p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              // `username` y no `email`: es lo que los gestores de contraseñas
              // asocian con la contraseña de al lado para guardarla y completarla.
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@turestaurante.com"
              required
            />
          </Field>
          <Field label="Contraseña">
            <Input
              type="password"
              // Al registrarse, `new-password` hace que el gestor ofrezca generar una.
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
          type="button"
          className="mt-4 w-full cursor-pointer text-center text-sm text-primary hover:underline"
          onClick={switchMode}
        >
          {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Ingresá'}
        </button>
      </div>
    </main>
  )
}

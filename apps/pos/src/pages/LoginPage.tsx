import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { employeeEmail } from '@restaurant-platform/shared'
import { Button, ErrorText, Field, IconButton, Input } from '@restaurant-platform/ui'
import { employeeEmailDomain, supabase } from '@/lib/supabase'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const email = employeeEmail(username, employeeEmailDomain)
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      // El detalle del rechazo no se muestra: solo si las credenciales no sirven.
      if (authError) {
        setError(
          authError.code === 'invalid_credentials'
            ? 'Usuario o contraseña incorrectos.'
            : 'No pudimos iniciar sesión. Intentá de nuevo o pedí ayuda a tu administrador.',
        )
      }
    } catch (err) {
      // Lo que se rechaza antes de llegar a Auth: un usuario mal escrito trae su
      // propio mensaje desde employeeEmail.
      setError(err)
    } finally {
      setBusy(false)
      setPassword('')
      setShowPassword(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-xl bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold">Ingresar al POS</h1>

        <Field label="Usuario">
          <Input
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoFocus
          />
        </Field>

        {/* El botón va fuera del <label> (adentro, su nombre se sumaría al del
            campo) y se apoya sobre el borde derecho del campo: los dos miden 44px. */}
        <div className="relative">
          <Field label="Contraseña">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              // A la vista es un campo de texto: el teclado de la tablet no tiene
              // que corregirla ni ponerle mayúscula.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="pr-12"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <div className="absolute right-0 bottom-0">
            {/* Rótulo fijo y aria-pressed: el lector anuncia «Mostrar contraseña,
                activado», no un nombre que cambia en cada toque. */}
            <IconButton
              label="Mostrar contraseña"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </IconButton>
          </div>
        </div>

        <ErrorText error={error} fallback="No pudimos iniciar sesión." />

        <Button className="w-full" disabled={busy}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </Button>

        <p className="text-sm text-muted">
          Si olvidaste tu contraseña, pedí a tu administrador que la restablezca.
        </p>
      </form>
    </main>
  )
}

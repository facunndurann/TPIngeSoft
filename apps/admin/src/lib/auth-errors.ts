import type { AuthError } from '@supabase/supabase-js'

/**
 * Supabase Auth responde en inglés («User already registered»): el panel lee el
 * `code` estable del error, no su texto, y dice lo mismo en castellano y con qué
 * hacer después. Lo que no está acá cae en un mensaje genérico, nunca en el inglés.
 */
const authMessages: Partial<Record<string, string>> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  email_not_confirmed: 'Todavía no confirmaste tu email. Abrí el enlace que te mandamos y volvé a ingresar.',
  user_already_exists: 'Ya existe una cuenta con ese email. Ingresá con tu contraseña.',
  email_exists: 'Ya existe una cuenta con ese email. Ingresá con tu contraseña.',
  weak_password: 'La contraseña es muy fácil de adivinar. Probá con una más larga que combine letras y números.',
  email_address_invalid: 'Ese email no es válido. Revisá cómo lo escribiste.',
  email_address_not_authorized: 'No podemos mandar emails a esa dirección. Probá con otra.',
  validation_failed: 'Revisá el email y la contraseña.',
  signup_disabled: 'El alta de cuentas nuevas está deshabilitada. Pedile acceso a quien administra el restaurante.',
  over_email_send_rate_limit: 'Mandamos demasiados emails en poco tiempo. Esperá unos minutos y volvé a intentar.',
  over_request_rate_limit: 'Hubo demasiados intentos seguidos. Esperá unos minutos y volvé a intentar.',
}

export type AuthMode = 'login' | 'signup'

/** El mensaje para un rechazo de Auth al ingresar o al crear la cuenta. */
export function authErrorMessage(error: Pick<AuthError, 'code'>, mode: AuthMode): string {
  const known = error.code ? authMessages[error.code] : undefined
  if (known) return known
  return mode === 'login'
    ? 'No pudimos iniciar sesión. Revisá tu conexión e intentá de nuevo.'
    : 'No pudimos crear la cuenta. Revisá tu conexión e intentá de nuevo.'
}

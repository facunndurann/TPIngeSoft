import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Database } from '../../../packages/shared/src/database.types.ts'
import { AppError } from '../../../packages/shared/src/errors.ts'

type Client = SupabaseClient<Database>

/** En el servidor no hay sesión que guardar ni refrescar, ni un redirect que leer. */
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

/** Cliente con la identidad de quien llama: Postgres ve su `auth.uid()` y le aplica la RLS. */
export function callerClient(url: string, anonKey: string, jwt: string): Client {
  return createClient<Database>(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth })
}

/** Service role: saltea la RLS. Solo para lo que la función ya autorizó por su cuenta. */
export function adminClient(url: string, serviceKey: string): Client {
  return createClient<Database>(url, serviceKey, { auth })
}

/**
 * El usuario del JWT, verificado contra Auth (también una sesión anónima). Nunca
 * se confía en el payload sin verificar: si Auth no lo reconoce, AUTH_REQUIRED.
 */
export async function verifiedUser(client: Client, jwt: string): Promise<User> {
  const { data, error } = await client.auth.getUser(jwt)
  if (error || !data.user) throw new AppError('AUTH_REQUIRED')
  return data.user
}

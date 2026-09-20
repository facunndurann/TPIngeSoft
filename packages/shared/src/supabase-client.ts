import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

export type AppSupabaseClient = SupabaseClient<Database>

export type SupabaseClientConfig = {
  url: string | undefined
  anonKey: string | undefined
  /** Una clave por app: si dos apps comparten origen no se pisan la sesión. */
  storageKey: string
  /** El POS no vuelve por redirect de OAuth y no necesita leer el hash. */
  detectSessionInUrl?: boolean
}

/**
 * Project URL, no Data API URL: un valor terminado en `/rest/v1` mandaría el
 * login a PostgREST y devolvería PGRST125. Estaba arreglado solo en el POS, y
 * el admin y el comensal seguían con el bug; con un único cliente no se puede
 * volver a arreglar en una app sola.
 */
function projectUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '')
}

export function createSupabaseClient({
  url,
  anonKey,
  storageKey,
  detectSessionInUrl,
}: SupabaseClientConfig): AppSupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ver docs/SETUP.md)',
    )
  }
  return createClient<Database>(projectUrl(url), anonKey, {
    auth: { storageKey, ...(detectSessionInUrl === undefined ? {} : { detectSessionInUrl }) },
  })
}

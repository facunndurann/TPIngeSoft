import { createClient, type PostgrestSingleResponse, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'
import { fromPostgres } from './errors.ts'

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

/**
 * Única salida de una respuesta de PostgREST (`from` o `rpc`): el dato, o el
 * error ya traducido por el catálogo. Ninguna pantalla muestra texto crudo de
 * Postgres ni decide por su cuenta qué constraints traducir: un código nuevo en
 * el catálogo llega solo a todas las llamadas.
 *
 * `fallback` es para quien puede decir qué operación falló («No pudimos
 * actualizar la cuenta»): reemplaza al mensaje genérico solo cuando el error no
 * es del catálogo, así un rechazo conocido sigue diciendo lo suyo.
 */
export function unwrap<T>(response: PostgrestSingleResponse<T>, fallback?: string): T {
  if (response.error) throw fromPostgres(response.error, fallback)
  return response.data
}

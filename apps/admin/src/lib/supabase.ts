import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { createSupabaseClient, fromPostgres } from '@restaurant-platform/shared'

export const supabase = createSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  storageKey: 'restaurant-admin-auth',
})

/**
 * Única salida de una respuesta de PostgREST (`from` o `rpc`): el dato, o el
 * error ya traducido por el catálogo. Ninguna pantalla muestra texto crudo de
 * Postgres ni decide por su cuenta qué constraints traducir: un código nuevo en
 * el catálogo llega solo a todas las llamadas.
 */
export function unwrap<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) throw fromPostgres(response.error)
  return response.data
}

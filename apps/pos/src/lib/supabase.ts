import { createClient } from '@supabase/supabase-js'
import type { Database } from '@restaurant-platform/shared'

/** Project URL only. A Data API value (`…/rest/v1`) would send Auth to PostgREST (PGRST125). */
function projectUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '')
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ? projectUrl(import.meta.env.VITE_SUPABASE_URL)
  : undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ver docs/SETUP.md)',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'restaurant-pos-auth', detectSessionInUrl: false },
})

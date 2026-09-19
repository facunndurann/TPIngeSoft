import { createClient } from '@supabase/supabase-js'
import type { Database } from '@restaurant-platform/shared'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ver docs/SETUP.md)',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'restaurant-admin-auth' },
})

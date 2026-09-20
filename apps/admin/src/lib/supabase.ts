import { createSupabaseClient } from '@restaurant-platform/shared'

export const supabase = createSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  storageKey: 'restaurant-admin-auth',
})

import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { AuthContext } from './auth-context'
import { queryClient } from '@/lib/queryClient'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let userId: string | null | undefined

    supabase.auth.getSession().then(({ data }) => {
      userId = data.session?.user.id ?? null
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const nextUserId = newSession?.user.id ?? null
      // Supabase re-emite la sesión al volver a la pestaña (token refresh).
      // Vaciar el cache ahí remonta todo el panel como si hubiera un F5.
      if (userId !== undefined && userId !== nextUserId) {
        queryClient.clear()
      }
      userId = nextUserId
      setSession(newSession)
      setLoading(false)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  return <AuthContext value={{ session, loading }}>{children}</AuthContext>
}

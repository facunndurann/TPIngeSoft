import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

export type AuthState = { session: Session | null; loading: boolean }

export const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

type AuthProviderProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente llega tipado con el Database de cada app
  client: SupabaseClient<any, any, any>
  queryClient: QueryClient
  children: ReactNode
}

/**
 * Sesión de Supabase para las apps con login (admin y POS). El cliente y el
 * cache llegan por props: cada app tiene los suyos, con su propio storageKey.
 */
export function AuthProvider({ client, queryClient, children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let userId: string | null | undefined

    void client.auth.getSession().then(({ data }) => {
      userId = data.session?.user.id ?? null
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, newSession) => {
      const nextUserId = newSession?.user.id ?? null
      // Supabase re-emite la sesión al volver a la pestaña (token refresh).
      // Vaciar el cache ahí remonta toda la app como si hubiera un F5.
      if (userId !== undefined && userId !== nextUserId) queryClient.clear()
      userId = nextUserId
      setSession(newSession)
      setLoading(false)
    })

    return () => subscription.subscription.unsubscribe()
  }, [client, queryClient])

  return <AuthContext value={{ session, loading }}>{children}</AuthContext>
}

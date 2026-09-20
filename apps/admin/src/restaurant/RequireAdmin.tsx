import type { ReactNode } from 'react'
import { Button, ErrorText } from '@restaurant-platform/ui'
import { supabase } from '@/lib/supabase'
import { useIsAdmin } from './restaurant-context'

export function RequireAdmin({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin()
  if (!isAdmin) return <div><ErrorText message="Tu cuenta no tiene acceso administrativo." /><Button onClick={() => supabase.auth.signOut()}>Cerrar sesión</Button></div>
  return <>{children}</>
}

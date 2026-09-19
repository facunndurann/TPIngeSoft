import { createContext, useContext } from 'react'
import type { Database } from '@restaurant-platform/shared'

export type PosContext = Database['public']['Functions']['get_pos_contexts']['Returns'][number]
export const AccessContext = createContext<PosContext | null>(null)
export function usePosContext() {
  const context = useContext(AccessContext)
  if (!context) throw new Error('Falta el contexto POS')
  return context
}
export function useRestaurant() {
  const c = usePosContext()
  return { id: c.restaurant_id, name: c.restaurant_name, branchId: c.branch_id }
}

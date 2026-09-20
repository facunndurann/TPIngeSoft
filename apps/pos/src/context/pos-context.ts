import { createContext, useContext } from 'react'
import type { Database, PosPermission } from '@restaurant-platform/shared'

export type PosContext = Database['public']['Functions']['get_pos_contexts']['Returns'][number]

export const AccessContext = createContext<PosContext | null>(null)

export function usePosContext() {
  const context = useContext(AccessContext)
  if (!context) throw new Error('Falta el contexto POS')
  return context
}

/**
 * Chequeo de permisos tipado. `permissions` llega de la base como `string[]`;
 * este es el único lugar donde esa lista suelta se cruza con el catálogo, así
 * que un permiso inexistente deja de compilar en vez de esconder un botón.
 */
export function useCan(): (permission: PosPermission) => boolean {
  const { permissions } = usePosContext()
  return (permission) => permissions.includes(permission)
}

export function useRestaurant() {
  const context = usePosContext()
  return { id: context.restaurant_id, name: context.restaurant_name, branchId: context.branch_id }
}

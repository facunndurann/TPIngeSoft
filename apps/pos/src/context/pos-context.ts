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

/** Dónde opera la cuenta: la sucursal, y su restaurante, de todas las lecturas del POS. */
export type PosScope = { restaurantId: string; branchId: string }

export function scopeOf(context: Pick<PosContext, 'restaurant_id' | 'branch_id'>): PosScope {
  return { restaurantId: context.restaurant_id, branchId: context.branch_id }
}

/** El scope del contexto elegido: lo único que cada pantalla le pasa a sus queries. */
export function usePosScope(): PosScope {
  return scopeOf(usePosContext())
}

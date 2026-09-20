import { createContext, useContext } from 'react'
import type { PaymentMethod } from '@restaurant-platform/shared'
import type { Announce } from '@/features/announcements'
import type { useTableSession } from '@/hooks/useTableSession'
import type { CartItem } from '@/stores/cart'

type TableSession = ReturnType<typeof useTableSession>

/**
 * Lo que la mesa sabe de sí misma. Lo publica `TableApp` y lo leen sus paneles:
 * antes cada pantalla de ruta copiaba su porción a mano para pasarla por props,
 * así que un dato de la mesa podía llegar distinto según por dónde viniera.
 */
export type TableContextValue = {
  token: string
  client: TableSession['client']
  menu: TableSession['menu']
  session: TableSession['session']
  sessionId?: string
  userId?: string
  cartKey: string
  items: CartItem[]
  /** Medios de pago habilitados en la sucursal de la mesa (MI-48). */
  paymentMethods: PaymentMethod[]
  sessionOpen: boolean
  named: boolean
  /** El carrito admite cambios: mesa abierta y sin envíos pendientes. */
  canEdit: boolean
  announce: Announce
}

export const TableContext = createContext<TableContextValue | null>(null)

export function useTable(): TableContextValue {
  const value = useContext(TableContext)
  if (!value) throw new Error('La mesa todavía no está lista.')
  return value
}

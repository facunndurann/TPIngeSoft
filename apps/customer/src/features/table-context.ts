import { createContext, useContext } from 'react'
import type { PaymentMethod } from '@restaurant-platform/shared'
import type { Announce } from '@/features/announcements'
import type { RequireName } from '@/features/name-gate'
import type { CartItem } from '@/features/cart'
import type { useTableSession } from '@/hooks/useTableSession'

type TableSession = ReturnType<typeof useTableSession>

/**
 * Lo que la mesa sabe de sí misma. Lo publica `TableApp` y lo leen sus paneles:
 * antes cada pantalla de ruta copiaba su porción a mano para pasarla por props,
 * así que un dato de la mesa podía llegar distinto según por dónde viniera.
 */
export type TableContextValue = {
  token: string
  menu: TableSession['menu']
  session: TableSession['session']
  sessionId?: string
  /** Relee sesión, pedidos, cuenta y pagos; se resuelve cuando ya están al día. */
  refreshTable: TableSession['refreshTable']
  // Quién es este comensal y cómo se nombra a cada uno: lo decide `dinerIn`, una
  // sola vez por lectura de la sesión, y nadie lo vuelve a derivar.
  me: TableSession['me']
  nameOf: TableSession['nameOf']
  named: boolean
  /**
   * Envuelve lo que deja algo a nombre del comensal (agregar, repetir, enviar): sin
   * nombre elegido, abre el diálogo y lo hace apenas lo guarde.
   */
  requireName: RequireName
  sessionOpen: boolean
  /** La mesa cerró su cuenta; no es lo contrario de `sessionOpen`, que además exige una lectura sana. */
  closed: boolean
  cartKey: string
  items: CartItem[]
  /** Total estimado del carrito con los precios de la carta de ahora; 0 hasta que la carta carga. */
  cartTotal: number
  /** Medios de pago habilitados en la sucursal de la mesa (MI-48). */
  paymentMethods: PaymentMethod[]
  /** Por qué el carrito no admite cambios ahora (lo decide `cartLock`); sin valor, los admite. */
  editLock?: string
  announce: Announce
}

export const TableContext = createContext<TableContextValue | null>(null)

export function useTable(): TableContextValue {
  const value = useContext(TableContext)
  if (!value) throw new Error('La mesa todavía no está lista.')
  return value
}

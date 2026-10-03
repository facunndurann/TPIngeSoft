import { formatPrice, type PosTableState } from '@restaurant-platform/shared'
import type { PosDiningTable, PosOpenSession } from './queries'

/**
 * Una mesa del plano con lo que el POS sabe de ella. Tiene la forma de una mesa,
 * así el plano (`FloorPlan`) y su cámara la reciben tal cual, y cada mesa se
 * dibuja con su sesión a mano.
 */
export type FloorMapEntry = PosDiningTable & {
  session?: PosOpenSession
  state: PosTableState
}

/**
 * Total de la mesa listo para mostrar, o null si no hay sesión o si quien mira
 * no tiene `payments.read`: la vista trae ese importe en null, y la mesa no
 * muestra un «$ 0» que no es.
 */
export function visibleTotal(session: PosOpenSession | undefined): string | null {
  if (!session || session.total_amount === null) return null
  return formatPrice(session.total_amount)
}

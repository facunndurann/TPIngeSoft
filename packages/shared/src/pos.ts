import type { Database } from './database.types.ts'
import type { OrderStatus } from './orders.ts'

// Solo la máquina de estados de pedidos. El layout del tablero y el manejo de
// fechas del POS viven en apps/admin/src/features/pos.

export type PosStep = { to: OrderStatus; label: string }

/** Tipos de transición: los define el enum `order_transition_kind` de la base. */
export type PosTransitionKind = Database['public']['Enums']['order_transition_kind']

/** Botones del tablero para un estado, uno por tipo de transición. */
export type PosOrderActions = Partial<Record<PosTransitionKind, PosStep>>

const cancel: PosStep = { to: 'cancelled', label: 'Cancelar' }

/**
 * Acciones que ofrece el tablero en cada estado. La base es la fuente de verdad
 * (tabla `order_status_transitions`, que usa `transition_order`);
 * supabase/tests/orders.integration.mjs falla si este mapa no coincide con ella
 * en pares y tipos.
 */
export const posActions: Record<OrderStatus, PosOrderActions> = {
  submitted: {
    advance: { to: 'accepted', label: 'Aceptar' },
    cancel,
  },
  accepted: {
    advance: { to: 'in_preparation', label: 'Preparar' },
    cancel,
  },
  in_preparation: {
    advance: { to: 'ready', label: 'Marcar listo' },
    revert: { to: 'accepted', label: 'Volver a nuevo' },
    cancel,
  },
  ready: {
    advance: { to: 'delivered', label: 'Entregar' },
    revert: { to: 'in_preparation', label: 'Volver a preparar' },
    cancel,
  },
  delivered: {
    revert: { to: 'ready', label: 'Volver a listo' },
  },
  cancelled: {},
}

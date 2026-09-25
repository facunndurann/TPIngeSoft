/**
 * El tablero de comandas y el estado operativo de las mesas: lo que el POS
 * dibuja y en qué orden. La plata, el tiempo y las solicitudes de la mesa son
 * conceptos de toda la plataforma y viven en sus propios módulos.
 */
import { Constants, type Database } from './database.types.ts'
import type { OrderStatus } from './orders.ts'
import { type SessionRequestSource, sessionRequestLabels } from './session-requests.ts'

export const posBoardColumns = [
  { id: 'new', label: 'Nuevo', statuses: ['submitted', 'accepted'] },
  { id: 'in_preparation', label: 'En preparación', statuses: ['in_preparation'] },
  { id: 'ready', label: 'Listo', statuses: ['ready'] },
  { id: 'delivered', label: 'Entregado', statuses: ['delivered'] },
] as const

export type PosBoardColumnId = (typeof posBoardColumns)[number]['id']

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

/**
 * Un pedido sigue siendo comanda de cocina mientras todavía puede avanzar. La
 * vista `pos_open_sessions` aplica la misma regla contra `order_status_transitions`.
 */
export function isKitchenTicket(status: OrderStatus): boolean {
  return posActions[status].advance !== undefined
}

/** Estados de las comandas de cocina, en el orden del enum: lo que el tablero pide a la base. */
export const kitchenTicketStatuses: readonly OrderStatus[] =
  Constants.public.Enums.order_status.filter(isKitchenTicket)

export type PosTableState =
  | 'free'
  | 'occupied'
  | 'order_pending'
  | 'in_preparation'
  | 'ready'
  | 'bill_requested'
  | 'in_person_payment'
  | 'payment_pending'

export const posTableStateLabels: Record<PosTableState, string> = {
  free: 'Libre',
  occupied: 'Ocupada',
  order_pending: 'Pedido pendiente',
  in_preparation: 'En preparación',
  ready: 'Listo para servir',
  bill_requested: sessionRequestLabels.bill,
  in_person_payment: sessionRequestLabels.in_person_payment,
  payment_pending: 'Cobro pendiente',
}

/**
 * Sesión abierta tal como la trae la vista `pos_open_sessions`, que es la
 * única lectura de mesas abiertas del POS.
 */
export type PosTableStateSession = SessionRequestSource & {
  /** Estados de las comandas de cocina de la mesa (ver `isKitchenTicket`). */
  kitchen_statuses: readonly OrderStatus[]
  /** Hay un pago electrónico iniciado que el proveedor todavía no confirmó. */
  has_pending_payment: boolean
}

/**
 * Estado principal de una mesa, ordenado por prioridad operativa. Recibe la
 * sesión entera (o `null` si está libre) en lugar de campos sueltos: así el
 * plano y la comanda no tienen que armar el mismo objeto cada uno.
 * Los rótulos se muestran junto al color para que el mapa no dependa solo de la vista.
 */
export function getPosTableState(session: PosTableStateSession | null | undefined): PosTableState {
  if (!session) return 'free'
  // Una mesa que llamó al mozo para cobrarle va primero, y se distingue de un
  // pago electrónico a medio confirmar: la primera necesita que alguien vaya.
  if (session.in_person_payment_requested_at) return 'in_person_payment'
  if (session.has_pending_payment) return 'payment_pending'
  if (session.bill_requested_at) return 'bill_requested'

  const statuses = session.kitchen_statuses
  if (statuses.includes('ready')) return 'ready'
  if (statuses.includes('submitted') || statuses.includes('accepted')) return 'order_pending'
  if (statuses.includes('in_preparation')) return 'in_preparation'
  return 'occupied'
}

export function posColumnFor(status: OrderStatus): PosBoardColumnId | null {
  for (const column of posBoardColumns) {
    if ((column.statuses as readonly OrderStatus[]).includes(status)) return column.id
  }
  return null
}

/** Cocina y barra atienden por orden de llegada; el resto muestra lo último primero. */
function sortColumnOrders<T extends { created_at: string }>(
  columnId: PosBoardColumnId,
  orders: T[],
): T[] {
  const copy = [...orders]
  const fifo = columnId === 'in_preparation' || columnId === 'ready'
  return copy.sort((a, b) => fifo
    ? a.created_at.localeCompare(b.created_at)
    : b.created_at.localeCompare(a.created_at))
}

export function groupOrdersByColumn<T extends { status: OrderStatus; created_at: string }>(
  orders: T[],
): Record<PosBoardColumnId, T[]> {
  const grouped = Object.fromEntries(
    posBoardColumns.map((column) => [column.id, [] as T[]]),
  ) as Record<PosBoardColumnId, T[]>
  for (const order of orders) {
    const column = posColumnFor(order.status)
    if (column) grouped[column].push(order)
  }
  for (const column of posBoardColumns) {
    grouped[column.id] = sortColumnOrders(column.id, grouped[column.id])
  }
  return grouped
}

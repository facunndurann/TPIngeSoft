import type { Database } from './database.types.ts'
import type { OrderStatus } from './orders.ts'

export const POS_TIME_ZONE = 'America/Argentina/Buenos_Aires'

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

const POS_ERROR_CODES = [
  'AUTH_REQUIRED',
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'FORBIDDEN',
  'ORDER_NOT_FOUND',
  'TABLE_NOT_FOUND',
  'TABLE_UNAVAILABLE',
  'TABLE_OCCUPIED',
  'TABLE_BRANCH_MISMATCH',
  'SESSION_MOVE_CONFLICT',
  'EMPLOYEE_NOT_FOUND',
  'INVALID_TRANSITION',
  'POS_UNAVAILABLE',
  'POS_UNSUPPORTED',
] as const

export type PosErrorCode = (typeof POS_ERROR_CODES)[number]

/** Un pedido sigue siendo comanda de cocina mientras todavía puede avanzar. */
export function isKitchenTicket(status: OrderStatus): boolean {
  return posActions[status].advance !== undefined
}

export type PosTableState =
  | 'free'
  | 'occupied'
  | 'order_pending'
  | 'in_preparation'
  | 'ready'
  | 'bill_requested'
  | 'payment_pending'

export const posTableStateLabels: Record<PosTableState, string> = {
  free: 'Libre',
  occupied: 'Ocupada',
  order_pending: 'Pedido pendiente',
  in_preparation: 'En preparación',
  ready: 'Listo para servir',
  bill_requested: 'Cuenta solicitada',
  payment_pending: 'Cobro pendiente',
}

export type PosTableStateInput = {
  hasOpenSession: boolean
  orderStatuses?: readonly OrderStatus[]
  billRequestedAt?: string | null
  inPersonPaymentRequestedAt?: string | null
  hasPendingPayment?: boolean
}

/**
 * Estado principal de una mesa, ordenado por prioridad operativa. Los rótulos
 * se muestran junto al color para que el mapa no dependa solo de la vista.
 */
export function getPosTableState(input: PosTableStateInput): PosTableState {
  if (!input.hasOpenSession) return 'free'
  if (input.inPersonPaymentRequestedAt || input.hasPendingPayment) return 'payment_pending'
  if (input.billRequestedAt) return 'bill_requested'

  const statuses = input.orderStatuses ?? []
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

export function sortColumnOrders<T extends { created_at: string }>(
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

export function asAmount(value: number | string | null | undefined): number {
  const amount = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

export function localDateKey(now: Date = new Date(), timeZone = POS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function wallTimeUtcMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), num('second'))
}

/** UTC bounds of a YYYY-MM-DD calendar day in the restaurant timezone. */
export function dayRangeUtc(dateKey: string, timeZone = POS_TIME_ZONE): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error('Invalid date key')
  }
  const startOf = (key: string) => {
    const utcMidnight = Date.parse(`${key}T00:00:00.000Z`)
    let instant = utcMidnight
    for (let i = 0; i < 3; i += 1) {
      instant = utcMidnight - (wallTimeUtcMs(new Date(instant), timeZone) - instant)
    }
    return instant
  }
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
  return { start: new Date(startOf(dateKey)).toISOString(), end: new Date(startOf(nextKey)).toISOString() }
}

export function formatElapsed(fromIso: string, nowMs = Date.now()): string {
  const elapsed = Math.max(0, nowMs - Date.parse(fromIso))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Ahora'
  if (minutes === 1) return 'Hace 1 min'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return hours === 1 ? 'Hace 1 h' : `Hace ${hours} h`
  return hours === 1 ? `Hace 1 h ${rest} min` : `Hace ${hours} h ${rest} min`
}

export function posErrorCode(message: string): PosErrorCode | 'UNKNOWN' {
  const match = POS_ERROR_CODES.find((code) => message === code || message.includes(code))
  return match ?? 'UNKNOWN'
}

export const posErrorMessages: Record<PosErrorCode, string> = {
  AUTH_REQUIRED: 'Tu sesión de administrador expiró. Volvé a ingresar.',
  INVALID_REQUEST: 'La solicitud no es válida.',
  SESSION_NOT_FOUND: 'No encontramos esa sesión de mesa.',
  FORBIDDEN: 'No tenés permiso para esta acción.',
  ORDER_NOT_FOUND: 'No encontramos ese pedido.',
  TABLE_NOT_FOUND: 'Esa mesa ya no existe. Actualizá el plano.',
  TABLE_UNAVAILABLE:
    'Esa mesa no está disponible para operar: puede estar fuera de servicio o en un sector dado de baja.',
  TABLE_OCCUPIED: 'La mesa destino ya tiene una comanda abierta. Elegí otra mesa.',
  TABLE_BRANCH_MISMATCH: 'La mesa destino debe estar en la misma sucursal.',
  SESSION_MOVE_CONFLICT: 'La comanda fue movida o cerrada por otro operador. Actualizá el plano.',
  EMPLOYEE_NOT_FOUND: 'Tu usuario del POS ya no está habilitado. Volvé a ingresar el PIN.',
  INVALID_TRANSITION: 'Ese cambio de estado no está permitido. Actualizá el tablero e intentá de nuevo.',
  POS_UNAVAILABLE: 'El POS no está activo para este restaurante.',
  POS_UNSUPPORTED: 'Este restaurante usa un POS externo que todavía no está conectado.',
}

export function posErrorMessage(message: string): string {
  const code = posErrorCode(message)
  return code === 'UNKNOWN' ? 'No pudimos completar la acción. Reintentá.' : posErrorMessages[code]
}

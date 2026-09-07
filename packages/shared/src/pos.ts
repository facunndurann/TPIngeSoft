import type { OrderStatus } from './orders.ts'

export const POS_TIME_ZONE = 'America/Argentina/Buenos_Aires'

export const posBoardColumns = [
  { id: 'new', label: 'Nuevo', statuses: ['submitted', 'accepted'] },
  { id: 'in_preparation', label: 'En preparación', statuses: ['in_preparation'] },
  { id: 'ready', label: 'Listo', statuses: ['ready'] },
  { id: 'delivered', label: 'Entregado', statuses: ['delivered'] },
] as const

export type PosBoardColumnId = (typeof posBoardColumns)[number]['id']

export const nextPosStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  submitted: 'accepted',
  accepted: 'in_preparation',
  in_preparation: 'ready',
  ready: 'delivered',
}

export const prevPosStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  in_preparation: 'accepted',
  ready: 'in_preparation',
  delivered: 'ready',
}

export const posAdvanceLabels: Partial<Record<OrderStatus, string>> = {
  submitted: 'Aceptar',
  accepted: 'Preparar',
  in_preparation: 'Marcar listo',
  ready: 'Entregar',
}

export const posRevertLabels: Partial<Record<OrderStatus, string>> = {
  in_preparation: 'Volver a nuevo',
  ready: 'Volver a preparar',
  delivered: 'Volver a listo',
}

const POS_ERROR_CODES = [
  'AUTH_REQUIRED',
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'FORBIDDEN',
  'ORDER_NOT_FOUND',
  'INVALID_TRANSITION',
  'POS_UNAVAILABLE',
  'POS_UNSUPPORTED',
] as const

export type PosErrorCode = (typeof POS_ERROR_CODES)[number]

export function canCancelOrder(status: OrderStatus): boolean {
  return status !== 'delivered' && status !== 'cancelled'
}

export function isKitchenTicket(status: OrderStatus): boolean {
  return status === 'submitted' || status === 'accepted'
    || status === 'in_preparation' || status === 'ready'
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
  INVALID_TRANSITION: 'Ese cambio de estado no está permitido. Actualizá el tablero e intentá de nuevo.',
  POS_UNAVAILABLE: 'El POS no está activo para este restaurante.',
  POS_UNSUPPORTED: 'Este restaurante usa un POS externo que todavía no está conectado.',
}

export function posErrorMessage(message: string): string {
  const code = posErrorCode(message)
  return code === 'UNKNOWN' ? 'No pudimos completar la acción. Reintentá.' : posErrorMessages[code]
}

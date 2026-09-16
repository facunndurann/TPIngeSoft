import type { OrderStatus } from '@restaurant-platform/shared'

/** Columnas del tablero de comandas y los estados que agrupa cada una. */
export const posBoardColumns = [
  { id: 'new', label: 'Nuevo', statuses: ['submitted', 'accepted'] },
  { id: 'in_preparation', label: 'En preparación', statuses: ['in_preparation'] },
  { id: 'ready', label: 'Listo', statuses: ['ready'] },
  { id: 'delivered', label: 'Entregado', statuses: ['delivered'] },
] as const

export type PosBoardColumnId = (typeof posBoardColumns)[number]['id']

export function posColumnFor(status: OrderStatus): PosBoardColumnId | null {
  for (const column of posBoardColumns) {
    if ((column.statuses as readonly OrderStatus[]).includes(status)) return column.id
  }
  return null
}

// Cocina trabaja en orden de llegada (FIFO) en preparación y listos; en el resto
// de las columnas lo más reciente va primero.
function sortColumnOrders<T extends { created_at: string }>(columnId: PosBoardColumnId, orders: T[]): T[] {
  const fifo = columnId === 'in_preparation' || columnId === 'ready'
  return [...orders].sort((a, b) => fifo
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

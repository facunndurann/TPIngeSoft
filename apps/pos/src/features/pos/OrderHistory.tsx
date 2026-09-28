import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Constants, countLabel, formatClock, formatPrice, localDateKey, type OrderStatus, orderStatusLabels, sessionPlaceLabel } from '@restaurant-platform/shared'
import { useRestaurant } from '@/context/pos-context'
import { EmptyState, Input, Modal, QueryView, Select } from '@restaurant-platform/ui'
import { OrderItemLine } from './OrderItemLine'
import { posHistoryQuery, type PosOrder } from './queries'
import { OrderStatusBadge } from './StatusBadges'

type StatusFilter = 'all' | OrderStatus

/** Todos los estados del enum de la base, en su orden: uno nuevo aparece solo. */
const statusFilterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  ...Constants.public.Enums.order_status.map((status) => ({ value: status, label: orderStatusLabels[status] })),
]

/** Los pedidos que dejan ver el estado elegido y la búsqueda por mesa, producto, comensal o id. */
function filterOrders(orders: PosOrder[], status: StatusFilter, search: string) {
  const query = search.trim().toLocaleLowerCase()
  return orders.filter((order) => {
    if (status !== 'all' && order.status !== status) return false
    if (!query) return true
    const table = sessionPlaceLabel(order.table_sessions).toLocaleLowerCase()
    const products = order.order_items.map((item) => item.product_name.toLocaleLowerCase()).join(' ')
    const people = order.table_sessions.session_participants
      .map((participant) => participant.display_name.toLocaleLowerCase())
      .join(' ')
    return table.includes(query) || products.includes(query) || people.includes(query) || order.id.includes(query)
  })
}

/** Cuántos pedidos hay y cuánto suman en cuenta: los cancelados cuentan como pedido, no como plata. */
function totalsOf(orders: PosOrder[]) {
  return orders.reduce(
    (acc, order) => {
      if (order.status !== 'cancelled') acc.amount += order.total_amount
      acc.count += 1
      return acc
    },
    { amount: 0, count: 0 },
  )
}

export function OrderHistory() {
  const restaurant = useRestaurant()
  const [dateKey, setDateKey] = useState(() => localDateKey())
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PosOrder | null>(null)

  const history = useQuery(posHistoryQuery(restaurant.id, restaurant.branchId, dateKey))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Historial del día</h1>
        <p className="text-sm text-neutral-500">
          Pedidos del {formatLongDate(dateKey)}, con detalle de modificaciones y totales.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          type="date"
          className="w-44"
          value={dateKey}
          onChange={(event) => setDateKey(event.target.value || localDateKey())}
          aria-label="Fecha"
        />
        <Select
          className="w-56"
          value={status}
          onChange={(event) =>
            setStatus(statusFilterOptions.find((option) => option.value === event.target.value)?.value ?? 'all')
          }
          aria-label="Estado"
        >
          {statusFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          className="min-w-56 flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar mesa, producto o comensal"
        />
      </div>

      <QueryView query={history} fallback="No pudimos cargar el historial.">
        {(history) => {
          const filtered = filterOrders(history, status, search)
          const totals = totalsOf(filtered)
          return (
            <>
              <p className="text-sm text-neutral-600">
                {countLabel(totals.count, 'pedido')} · {formatPrice(totals.amount)} en cuenta (sin
                cancelados)
              </p>
              {filtered.length === 0 ? (
                <EmptyState message="No hay pedidos para ese filtro." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Hora</th>
                        <th className="px-4 py-3 font-medium">Mesa</th>
                        <th className="px-4 py-3 font-medium">Ítems</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                        <th className="px-4 py-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((order) => (
                        <tr
                          key={order.id}
                          className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                          onClick={() => setSelected(order)}
                        >
                          <td className="px-4 py-3 text-neutral-700">{formatClock(order.created_at)}</td>
                          {/* La fila entera abre el detalle con el mouse o el dedo; este botón
                              es la misma puerta para el teclado y el lector de pantalla. Sin
                              padding vertical: su alto táctil ya es el de la fila. */}
                          <td className="px-4 py-0">
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => setSelected(order)}
                              className="inline-flex min-h-11 cursor-pointer items-center rounded font-medium text-neutral-900 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:outline-none"
                            >
                              {sessionPlaceLabel(order.table_sessions)}
                              {/* Varias filas pueden ser de la misma mesa: la hora dice cuál se abre. */}
                              <span className="sr-only">, pedido de las {formatClock(order.created_at)}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-neutral-600">
                            {order.order_items
                              .map((item) => `${item.quantity} × ${item.product_name}`)
                              .join(', ')}
                          </td>
                          <td className="px-4 py-3">
                            <OrderStatusBadge status={order.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-neutral-900">
                            {formatPrice(order.total_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        }}
      </QueryView>

      {selected && (
        <Modal title={`${sessionPlaceLabel(selected.table_sessions)} · ${formatClock(selected.created_at)}`} onClose={() => setSelected(null)}>
          <HistoryDetail order={selected} />
        </Modal>
      )}
    </div>
  )
}

function HistoryDetail({ order }: { order: PosOrder }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <OrderStatusBadge status={order.status} />
        <span className="font-semibold">{formatPrice(order.total_amount)}</span>
      </div>
      <p className="text-xs text-neutral-500">#{order.id.slice(0, 8)}</p>
      {order.order_items.map((item) => (
        <div key={item.id} className="rounded-lg border border-neutral-200 px-3 py-2">
          <OrderItemLine order={order} item={item} withPrices />
        </div>
      ))}
      {order.notes && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">Nota: {order.notes}</p>}
    </div>
  )
}

function formatLongDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(year, month - 1, day))
}

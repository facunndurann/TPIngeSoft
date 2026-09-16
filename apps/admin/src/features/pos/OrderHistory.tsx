import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { localDateKey, orderStatusLabels } from '@restaurant-platform/shared'
import type { OrderStatus } from '@restaurant-platform/shared'
import { formatPrice } from '@/lib/format'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, EmptyState, ErrorText, Input, Modal, Select, Spinner } from '@/components/ui'
import { posHistoryQuery, type PosOrder } from './api'

const statusFilterOptions: Array<{ value: 'all' | OrderStatus; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'submitted', label: orderStatusLabels.submitted },
  { value: 'accepted', label: orderStatusLabels.accepted },
  { value: 'in_preparation', label: orderStatusLabels.in_preparation },
  { value: 'ready', label: orderStatusLabels.ready },
  { value: 'delivered', label: orderStatusLabels.delivered },
  { value: 'cancelled', label: orderStatusLabels.cancelled },
]

export function OrderHistory() {
  const restaurant = useRestaurant()
  const [dateKey, setDateKey] = useState(() => localDateKey())
  const [status, setStatus] = useState<'all' | OrderStatus>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PosOrder | null>(null)

  const history = useQuery(posHistoryQuery(restaurant.id, dateKey))

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return (history.data ?? []).filter((order) => {
      if (status !== 'all' && order.status !== status) return false
      if (!query) return true
      const table = order.table_sessions.tables.label.toLocaleLowerCase()
      const products = order.order_items.map((item) => item.product_name.toLocaleLowerCase()).join(' ')
      const people = order.table_sessions.session_participants
        .map((participant) => participant.display_name.toLocaleLowerCase())
        .join(' ')
      return table.includes(query) || products.includes(query) || people.includes(query) || order.id.includes(query)
    })
  }, [history.data, search, status])

  const totals = filtered.reduce(
    (acc, order) => {
      if (order.status !== 'cancelled') acc.amount += order.total_amount
      acc.count += 1
      return acc
    },
    { amount: 0, count: 0 },
  )

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
          onChange={(event) => setStatus(event.target.value as 'all' | OrderStatus)}
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

      <p className="text-sm text-neutral-600">
        {totals.count} pedido{totals.count === 1 ? '' : 's'} · {formatPrice(totals.amount)} en cuenta (sin
        cancelados)
      </p>

      {history.isError && (
        <ErrorText
          message={history.error instanceof Error ? history.error.message : 'No pudimos cargar el historial.'}
        />
      )}
      {history.isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
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
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    {order.table_sessions.tables.label}
                    <span className="block text-xs font-normal text-neutral-500">
                      {order.table_sessions.tables.branch?.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {order.order_items
                      .map((item) => `${item.quantity} × ${item.product_name}`)
                      .join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={order.status === 'cancelled' ? 'red' : order.status === 'delivered' ? 'green' : 'indigo'}>
                      {orderStatusLabels[order.status]}
                    </Badge>
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

      {selected && (
        <Modal title={`${selected.table_sessions.tables.label} · ${formatClock(selected.created_at)}`} onClose={() => setSelected(null)}>
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
        <Badge color={order.status === 'cancelled' ? 'red' : 'indigo'}>{orderStatusLabels[order.status]}</Badge>
        <span className="font-semibold">{formatPrice(order.total_amount)}</span>
      </div>
      <p className="text-xs text-neutral-500">#{order.id.slice(0, 8)}</p>
      {order.order_items.map((item) => (
        <div key={item.id} className="rounded-lg border border-neutral-200 px-3 py-2">
          <p className="font-medium text-neutral-900">
            {item.quantity} × {item.product_name}
          </p>
          {item.is_shared && <p className="text-xs text-neutral-500">Para compartir</p>}
          {item.order_item_modifiers.map((modifier) => (
            <p key={modifier.id} className="text-xs text-neutral-600">
              + {modifier.group_name}: {modifier.option_name} ({formatPrice(modifier.price_delta)})
            </p>
          ))}
          {item.order_item_removed_ingredients.map((ingredient) => (
            <p key={ingredient.id} className="text-xs text-neutral-600">
              Sin {ingredient.ingredient_name}
            </p>
          ))}
        </div>
      ))}
      {order.notes && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">Nota: {order.notes}</p>}
    </div>
  )
}

function formatClock(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatLongDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(year, month - 1, day))
}

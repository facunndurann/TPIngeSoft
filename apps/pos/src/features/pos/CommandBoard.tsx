import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dayRangeUtc,
  groupOrdersByColumn,
  localDateKey,
  posBoardColumns,
  type OrderStatus,
} from '@restaurant-platform/shared'
import { useRestaurant } from '@/context/pos-context'
import { ErrorText, Spinner } from '@/components/ui'
import { loadBoardOrders, transitionPosOrder } from './api'
import { OrderTicket } from './OrderTicket'
import { useNow } from './useNow'
import type { PosOrder } from './types'

const columnStyles: Record<string, string> = {
  new: 'border-amber-200 bg-amber-50',
  in_preparation: 'border-indigo-200 bg-indigo-50',
  ready: 'border-green-200 bg-green-50',
  delivered: 'border-neutral-200 bg-neutral-50',
}

export function CommandBoard() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const now = useNow()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null)

  const board = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'board'],
    queryFn: () => loadBoardOrders(restaurant.id, restaurant.branchId, dayRangeUtc(localDateKey()).start),
    refetchInterval: 15000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id] })

  const transition = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: PosOrder['status'] }) =>
      transitionPosOrder(orderId, status),
    onMutate: ({ orderId }) => {
      setPendingId(orderId)
      setActionError(null)
    },
    onSuccess: invalidate,
    onError: (error, { orderId }) => {
      setActionError({
        id: orderId,
        message: error instanceof Error ? error.message : 'No pudimos actualizar el pedido.',
      })
    },
    onSettled: () => setPendingId(null),
  })

  const grouped = useMemo(() => groupOrdersByColumn(board.data ?? []), [board.data])

  function handleTransition(order: PosOrder, to: OrderStatus) {
    // Cancelar saca el pedido de la cuenta: es la única acción que pide confirmación.
    const confirmed = to !== 'cancelled'
      || window.confirm(`¿Cancelar el pedido de ${order.table_sessions.tables.label}? Se saca de la cuenta.`)
    if (confirmed) transition.mutate({ orderId: order.id, status: to })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Comandas</h1>
        <p className="text-sm text-neutral-500">
          Pedidos en vivo. Los cambios se reflejan en la mesa del comensal.
        </p>
      </div>

      {board.isError && (
        <ErrorText
          message={board.error instanceof Error ? board.error.message : 'No pudimos cargar las comandas.'}
        />
      )}
      {board.isLoading ? (
        <Spinner />
      ) : (
        <div className="flex min-h-[32rem] flex-1 gap-3 overflow-x-auto pb-2">
          {posBoardColumns.map((column) => {
            const orders = grouped[column.id]
            return (
              <section
                key={column.id}
                aria-label={column.label}
                className={`flex w-72 shrink-0 flex-col rounded-xl border p-3 xl:w-auto xl:flex-1 ${columnStyles[column.id]}`}
              >
                <header className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-800">{column.label}</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-neutral-600">
                    {orders.length}
                  </span>
                </header>
                <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
                  {orders.length === 0 && (
                    <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-6 text-center text-xs text-neutral-500">
                      {column.id === 'new' ? 'No hay pedidos nuevos.' : 'Vacío'}
                    </p>
                  )}
                  {orders.map((order) => (
                    <OrderTicket
                      key={order.id}
                      order={order}
                      now={now}
                      busy={pendingId === order.id}
                      error={actionError?.id === order.id ? actionError.message : null}
                      onTransition={(to) => handleTransition(order, to)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

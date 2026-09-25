import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { groupOrdersByColumn, posBoardColumns } from '@restaurant-platform/shared'
import { useRestaurant } from '@/context/pos-context'
import { ErrorText, Spinner, useNow } from '@restaurant-platform/ui'
import { posBoardQuery } from './api'
import { OrderTicket } from './OrderTicket'

const columnStyles: Record<string, string> = {
  new: 'border-amber-200 bg-amber-50',
  in_preparation: 'border-indigo-200 bg-indigo-50',
  ready: 'border-green-200 bg-green-50',
  delivered: 'border-neutral-200 bg-neutral-50',
}

export function CommandBoard() {
  const restaurant = useRestaurant()
  const now = useNow()

  const board = useQuery(posBoardQuery(restaurant.id, restaurant.branchId))
  const grouped = useMemo(() => groupOrdersByColumn(board.data ?? []), [board.data])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Comandas</h1>
        <p className="text-sm text-neutral-500">
          Pedidos en vivo. Los cambios se reflejan en la mesa del comensal.
        </p>
      </div>

      {board.isError && (
        <ErrorText error={board.error} fallback="No pudimos cargar las comandas." />
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
                    <OrderTicket key={order.id} order={order} now={now} />
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

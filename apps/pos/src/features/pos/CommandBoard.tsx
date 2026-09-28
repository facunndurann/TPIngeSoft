import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { groupOrdersByColumn, posBoardColumns, type PosBoardColumnId } from '@restaurant-platform/shared'
import { usePosScope } from '@/context/pos-context'
import { IconButton, QueryView } from '@restaurant-platform/ui'
import { posBoardQuery } from './queries'
import { OrderTicket } from './OrderTicket'

const columnStyles: Record<PosBoardColumnId, string> = {
  new: 'border-amber-200 bg-amber-50',
  in_preparation: 'border-indigo-200 bg-indigo-50',
  ready: 'border-green-200 bg-green-50',
  delivered: 'border-neutral-200 bg-neutral-50',
}

/** La columna que se puede plegar: la que menos se consulta durante el servicio. */
const COLLAPSIBLE: PosBoardColumnId = 'delivered'
const COLLAPSED_KEY = 'pos-board:delivered-collapsed'

// Es una comodidad de cada tablet (la de cocina la deja plegada), no un dato
// compartido: si el navegador no deja guardar, la columna arranca abierta.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function storeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* modo privado o storage bloqueado */
  }
}

export function CommandBoard() {
  const scope = usePosScope()
  const [deliveredCollapsed, setDeliveredCollapsed] = useState(readCollapsed)
  const listIdPrefix = useId()

  const board = useQuery(posBoardQuery(scope))

  function toggleDelivered() {
    const next = !deliveredCollapsed
    setDeliveredCollapsed(next)
    storeCollapsed(next)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Comandas</h1>
        <p className="text-sm text-neutral-500">
          Pedidos en vivo. Los cambios se reflejan en la mesa del comensal.
        </p>
      </div>

      <QueryView query={board} fallback="No pudimos cargar las comandas.">
        {(board) => {
          const grouped = groupOrdersByColumn(board)
          return (
            // Hasta `lg` las columnas tienen ancho fijo y la fila se desplaza; desde
            // `lg` (una tablet en horizontal) se reparten el ancho y entran todas.
            <div className="flex min-h-[32rem] flex-1 gap-3 overflow-x-auto pb-2">
              {posBoardColumns.map((column) => {
                const orders = grouped[column.id]
                const collapsible = column.id === COLLAPSIBLE
                const collapsed = collapsible && deliveredCollapsed
                const listId = `${listIdPrefix}-${column.id}`
                return (
                  <section
                    key={column.id}
                    aria-label={column.label}
                    className={`flex shrink-0 flex-col rounded-xl border ${columnStyles[column.id]} ${
                      collapsed ? 'w-16 items-center p-2' : 'w-72 p-3 lg:w-auto lg:min-w-0 lg:flex-1'
                    }`}
                  >
                    <header
                      className={collapsed ? 'flex flex-col items-center gap-2' : 'mb-3 flex items-center justify-between gap-2'}
                    >
                      {/* Plegada, el nombre va de costado: la tira mide lo que el botón. */}
                      <h2 className={`text-sm font-semibold text-neutral-800 ${collapsed ? 'order-2 [writing-mode:vertical-rl]' : ''}`}>
                        {column.label}
                      </h2>
                      <span className={`rounded-full bg-white px-2 py-0.5 text-xs font-medium text-neutral-600 ${collapsed ? 'order-3' : 'ml-auto'}`}>
                        {orders.length}
                      </span>
                      {/* Es el mismo botón abierta y plegada, en el mismo lugar del
                          árbol: el foco del teclado no se pierde al usarlo. */}
                      {collapsible && (
                        <div className={collapsed ? 'order-1' : ''}>
                          <IconButton
                            label={collapsed ? `Mostrar ${column.label}` : `Plegar ${column.label}`}
                            aria-expanded={!collapsed}
                            aria-controls={listId}
                            onClick={toggleDelivered}
                          >
                            {collapsed ? <ChevronsLeft size={18} aria-hidden="true" /> : <ChevronsRight size={18} aria-hidden="true" />}
                          </IconButton>
                        </div>
                      )}
                    </header>
                    {!collapsed && (
                      <div id={listId} className="flex-1 space-y-3 overflow-y-auto pr-0.5">
                        {orders.length === 0 && (
                          <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-6 text-center text-xs text-neutral-500">
                            {column.id === 'new' ? 'No hay pedidos nuevos.' : 'Vacío'}
                          </p>
                        )}
                        {orders.map((order) => (
                          <OrderTicket key={order.id} order={order} />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )
        }}
      </QueryView>
    </div>
  )
}

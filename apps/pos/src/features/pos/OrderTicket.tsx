import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Undo2, XCircle } from 'lucide-react'
import { countLabel, formatPrice, type OrderStatus, posActions, transitionPermission } from '@restaurant-platform/shared'
import { Button, Elapsed, ErrorText, Modal, useSaveErrors } from '@restaurant-platform/ui'
import { useCan } from '@/context/pos-context'
import { OrderItemLine } from './OrderItemLine'
import { participantName, transitionPosOrder, type PosOrder } from './queries'
import { OrderStatusBadge } from './StatusBadges'

/**
 * Una comanda con sus botones. Es dueña de su transición: el «Actualizando…»,
 * la confirmación al cancelar y el error son de este pedido, en el tablero y en
 * la comanda de la mesa por igual, sin que la pantalla que la muestra lleve la cuenta.
 */
export function OrderTicket({ order }: { order: PosOrder }) {
  const can = useCan()
  const errors = useSaveErrors()
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  // El botón sigue ocupado hasta que el cliente del POS relee el pedido en su
  // estado nuevo: no queda un instante habilitado con el estado viejo.
  const transition = useMutation(errors.saving('No pudimos actualizar el pedido.', {
    mutationFn: (to: OrderStatus) => transitionPosOrder(order.id, to),
  }))

  const allowed = (step: { to: OrderStatus; label: string } | undefined) =>
    step && can(transitionPermission(order.status, step.to)) ? step : undefined
  const actions = posActions[order.status]
  const advance = allowed(actions.advance)
  const revert = allowed(actions.revert)
  const cancel = allowed(actions.cancel)
  const table = order.table_sessions.tables
  const submitter = participantName(order, order.submitted_by)
  const busy = transition.isPending

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm flex flex-col">
      {/* Si el estado no entra al lado de la mesa, baja entero a la línea de
          abajo: la base de 8rem fuerza el salto antes de partir el rótulo. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-[1_1_8rem]">
          <p className="text-sm font-semibold text-neutral-900 break-words">{table.label}</p>
          <p className="text-xs text-neutral-500 break-words">
            {submitter} · <Elapsed since={order.created_at} precision="exact" />
          </p>
        </div>
        <OrderStatusBadge status={order.status} className="shrink-0 whitespace-nowrap" />
      </div>

      {order.table_sessions.status === 'closed' && (
        <p className="mt-2 text-xs font-medium text-amber-800">Mesa cerrada</p>
      )}

      <ul className="mt-3 space-y-2">
        {order.order_items.map((item) => (
          <li key={item.id}>
            <OrderItemLine order={order} item={item} />
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          <span className="font-medium">Nota: </span>
          {order.notes}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-neutral-500">Total</span>
        <strong className="text-neutral-900">{formatPrice(order.total_amount)}</strong>
      </div>

      {/* El aviso del ticket es una línea, no un panel. useSaveErrors ya resuelve
          el texto con el mismo catálogo que usa ErrorText. */}
      {errors.message && (
        <p className="mt-2 text-xs text-red-700">{errors.message}</p>
      )}

      <div className="mt-auto pt-3 flex flex-col gap-2">
        {advance && (
          <Button className="w-full" disabled={busy} onClick={() => transition.mutate(advance.to)}>
            {busy ? 'Actualizando…' : advance.label}
          </Button>
        )}
        {/* Volver atrás y cancelar van en su propia fila, separada: un toque
            apurado sobre el botón de avanzar no puede caer en una de estas. */}
        {(revert || cancel) && (
          <div className="flex gap-2 border-t border-neutral-100 pt-2">
            {revert && (
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => transition.mutate(revert.to)}>
                <Undo2 size={14} aria-hidden="true" /> {revert.label}
              </Button>
            )}
            {cancel && (
              <Button
                variant="danger-ghost"
                className="flex-1"
                disabled={busy}
                // El error de un intento anterior no se arrastra a la confirmación nueva.
                onClick={() => { errors.clear(); setConfirmingCancel(true) }}
              >
                <XCircle size={14} aria-hidden="true" /> {cancel.label}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Cancelar saca el pedido de la cuenta y no se puede deshacer: es la única
          transición que se confirma, con el mismo modal que el cierre de mesa. */}
      {confirmingCancel && cancel && (
        <Modal title={`Cancelar el pedido de ${table.label}`} onClose={() => setConfirmingCancel(false)}>
          <div className="space-y-3 text-sm text-neutral-700">
            <p className="font-medium text-neutral-900">
              {submitter} · {countLabel(order.order_items.length, 'ítem', 'ítems')} · {formatPrice(order.total_amount)}
            </p>
            <p>Se saca de la cuenta de la mesa y deja de verse en el tablero. No se puede deshacer.</p>
            <ErrorText error={errors.message} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmingCancel(false)}>
                Mantener pedido
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={busy}
                onClick={() => transition.mutate(cancel.to, { onSuccess: () => setConfirmingCancel(false) })}
              >
                {busy ? 'Cancelando…' : 'Cancelar pedido'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </article>
  )
}

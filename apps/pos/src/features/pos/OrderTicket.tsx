import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { formatElapsed, formatPrice, type OrderStatus, orderStatusLabels, posActions, transitionPermission } from '@restaurant-platform/shared'
import { Badge, Button, useSaveErrors } from '@restaurant-platform/ui'
import { posQueryKey, transitionPosOrder, type PosOrder, type PosOrderItem } from './api'
import { useCan, useRestaurant } from '@/context/pos-context'

function participantName(order: PosOrder, participantId: string | null) {
  return order.table_sessions.session_participants.find((entry) => entry.id === participantId)
    ?.display_name ?? 'Comensal'
}

/**
 * Una comanda con sus botones. Es dueña de su transición: el «Actualizando…»,
 * la confirmación al cancelar y el error son de este pedido, en el tablero y en
 * la comanda de la mesa por igual, sin que la pantalla que la muestra lleve la cuenta.
 */
export function OrderTicket({ order, now }: { order: PosOrder; now: number }) {
  const can = useCan()
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const errors = useSaveErrors()

  const transition = useMutation(errors.saving('No pudimos actualizar el pedido.', {
    mutationFn: (to: OrderStatus) => transitionPosOrder(order.id, to),
    // Se devuelve la promesa: el botón sigue ocupado hasta que llega el pedido
    // en su estado nuevo, y no queda un instante habilitado con el estado viejo.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: posQueryKey(restaurant.id, restaurant.branchId) }),
  }))

  const allowed = (step: { to: OrderStatus; label: string } | undefined) =>
    step && can(transitionPermission(order.status, step.to)) ? step : undefined
  const actions = posActions[order.status]
  const advance = allowed(actions.advance)
  const revert = allowed(actions.revert)
  const cancel = allowed(actions.cancel)
  const table = order.table_sessions.tables
  const branch = table.branch?.name
  const submitter = participantName(order, order.submitted_by)
  const busy = transition.isPending

  function move(to: OrderStatus) {
    // Cancelar saca el pedido de la cuenta: es la única transición que se confirma.
    const confirmed = to !== 'cancelled'
      || window.confirm(`¿Cancelar el pedido de ${table.label}? Se saca de la cuenta.`)
    if (confirmed) transition.mutate(to)
  }

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-neutral-900 break-words">{table.label}</p>
          <p className="text-xs text-neutral-500 break-words">
            {branch ? `${branch} · ` : ''}
            {submitter} · {formatElapsed(order.created_at, now, 'exact')}
          </p>
        </div>
        <Badge color={order.status === 'submitted' ? 'amber' : 'indigo'} className="max-w-[85px] shrink-0">
          {orderStatusLabels[order.status]}
        </Badge>
      </div>

      {order.table_sessions.status === 'closed' && (
        <p className="mt-2 text-xs font-medium text-amber-800">Sesión cerrada</p>
      )}

      <ul className="mt-3 space-y-2">
        {order.order_items.map((item) => (
          <li key={item.id}>
            <TicketLine item={item} owner={item.is_shared ? 'Para compartir' : participantName(order, item.participant_id)} />
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
        <div className="flex gap-2 w-full">
          {advance && (
            <Button className="flex-1" disabled={busy} onClick={() => move(advance.to)}>
              {busy ? 'Actualizando…' : advance.label}
            </Button>
          )}
          {cancel && (
            <Button variant="danger" disabled={busy} onClick={() => move(cancel.to)}>
              {cancel.label}
            </Button>
          )}
        </div>
        {revert && (
          <Button
            variant="ghost"
            className="w-full text-xs opacity-75 hover:opacity-100"
            disabled={busy}
            onClick={() => move(revert.to)}
          >
            <Undo2 size={12} /> {revert.label}
          </Button>
        )}
      </div>
    </article>
  )
}

function TicketLine({ item, owner }: { item: PosOrderItem; owner: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-neutral-900">
        {item.quantity} × {item.product_name}
      </p>
      <p className="text-xs text-neutral-500">{owner}</p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id} className="text-xs text-neutral-600">
          + {modifier.group_name}: {modifier.option_name}
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id} className="text-xs text-neutral-600">
          Sin {ingredient.ingredient_name}
        </p>
      ))}
    </div>
  )
}

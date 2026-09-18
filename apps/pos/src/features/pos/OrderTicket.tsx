import { Undo2 } from 'lucide-react'
import {
  formatElapsed,
  orderStatusLabels,
  posActions,
  transitionPermission,
  type OrderStatus,
} from '@restaurant-platform/shared'
import { formatPrice } from '@/lib/format'
import { Badge, Button } from '@/components/ui'
import type { PosOrder, PosOrderItem } from './types'
import { usePosContext } from '@/context/pos-context'

function participantName(order: PosOrder, participantId: string | null) {
  return order.table_sessions.session_participants.find((entry) => entry.id === participantId)
    ?.display_name ?? 'Comensal'
}

export function OrderTicket({
  order,
  now,
  busy,
  error,
  onTransition,
}: {
  order: PosOrder
  now: number
  busy: boolean
  error: string | null
  onTransition: (to: OrderStatus) => void
}) {
  const { permissions } = usePosContext()
  const allowed = (step: { to: OrderStatus; label: string } | undefined) =>
    step && permissions.includes(transitionPermission(order.status, step.to)) ? step : undefined
  const actions = posActions[order.status]
  const advance = allowed(actions.advance)
  const revert = allowed(actions.revert)
  const cancel = allowed(actions.cancel)
  const table = order.table_sessions.tables
  const branch = table.branch?.name
  const submitter = participantName(order, order.submitted_by)

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-neutral-900 break-words">{table.label}</p>
          <p className="text-xs text-neutral-500 break-words">
            {branch ? `${branch} · ` : ''}
            {submitter} · {formatElapsed(order.created_at, now)}
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

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <div className="mt-auto pt-3 flex flex-col gap-2">
        <div className="flex gap-2 w-full">
          {advance && (
            <Button className="flex-1" disabled={busy} onClick={() => onTransition(advance.to)}>
              {busy ? 'Actualizando…' : advance.label}
            </Button>
          )}
          {cancel && (
            <Button variant="danger" disabled={busy} onClick={() => onTransition(cancel.to)}>
              {cancel.label}
            </Button>
          )}
        </div>
        {revert && (
          <Button
            variant="ghost"
            className="w-full text-xs opacity-75 hover:opacity-100"
            disabled={busy}
            onClick={() => onTransition(revert.to)}
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

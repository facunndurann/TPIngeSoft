import {
  canCancelOrder,
  formatElapsed,
  nextPosStatus,
  orderStatusLabels,
  posAdvanceLabels,
} from '@restaurant-platform/shared'
import { formatPrice } from '@/lib/format'
import { Badge, Button } from '@/components/ui'
import type { PosOrder, PosOrderItem } from './types'

function participantName(order: PosOrder, participantId: string | null) {
  return order.table_sessions.session_participants.find((entry) => entry.id === participantId)
    ?.display_name ?? 'Comensal'
}

export function OrderTicket({
  order,
  now,
  busy,
  error,
  onAdvance,
  onCancel,
}: {
  order: PosOrder
  now: number
  busy: boolean
  error: string | null
  onAdvance: () => void
  onCancel: () => void
}) {
  const next = nextPosStatus[order.status]
  const advanceLabel = posAdvanceLabels[order.status]
  const table = order.table_sessions.tables
  const branch = table.branch?.name
  const submitter = participantName(order, order.submitted_by)

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900">{table.label}</p>
          <p className="truncate text-xs text-neutral-500">
            {branch ? `${branch} · ` : ''}
            {submitter} · {formatElapsed(order.created_at, now)}
          </p>
        </div>
        <Badge color={order.status === 'submitted' ? 'amber' : 'indigo'}>
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

      <div className="mt-3 flex gap-2">
        {next && advanceLabel && (
          <Button className="flex-1" disabled={busy} onClick={onAdvance}>
            {busy ? 'Actualizando…' : advanceLabel}
          </Button>
        )}
        {canCancelOrder(order.status) && (
          <Button variant="danger" disabled={busy} onClick={onCancel}>
            Cancelar
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

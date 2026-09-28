import { orderStatusLabels, type OrderStatus, type PosTableState, posTableStateLabels } from '@restaurant-platform/shared'
import { Badge } from '@restaurant-platform/ui'
import { orderStatusTone, tableStateStyles } from './status-colors'

/** El estado de un pedido con su rótulo y su color: el único lugar donde se juntan. */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge color={orderStatusTone[status]} className={className}>
      {orderStatusLabels[status]}
    </Badge>
  )
}

/** El estado de una mesa fuera del plano, con el mismo color que la mesa en el plano. */
export function TableStateBadge({ state }: { state: PosTableState }) {
  return <Badge color={tableStateStyles[state].tone}>{posTableStateLabels[state]}</Badge>
}

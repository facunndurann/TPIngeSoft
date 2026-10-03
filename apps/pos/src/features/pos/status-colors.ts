import type { OrderStatus, PosBoardColumnId, PosTableState } from '@restaurant-platform/shared'
import type { BadgeColor } from '@restaurant-platform/ui'

type TableStateStyle = {
  /** La etiqueta del estado fuera del plano: comanda, resumen de la mesa y avisos. */
  tone: BadgeColor
  /** La mesa dibujada en el plano. */
  tile: string
  /** El rótulo dentro de la mesa, un tono más fuerte que su fondo. La leyenda dibuja cada estado con `tile`. */
  tileLabel: string
}

/**
 * Todo lo visual de un estado de mesa en una sola entrada, así el plano, su
 * leyenda, la comanda y los avisos de la mesa no pueden quedar en colores
 * distintos. Las clases van escritas enteras para que Tailwind las encuentre.
 */
export const tableStateStyles: Record<PosTableState, TableStateStyle> = {
  free: {
    tone: 'green',
    tile: 'border-green-400 bg-green-50 text-green-950',
    tileLabel: 'bg-green-100 text-green-800',
  },
  occupied: {
    tone: 'neutral',
    tile: 'border-neutral-400 bg-neutral-100 text-neutral-900',
    tileLabel: 'bg-neutral-200 text-neutral-700',
  },
  order_pending: {
    tone: 'amber',
    tile: 'border-amber-500 bg-amber-50 text-amber-950',
    tileLabel: 'bg-amber-200 text-amber-900',
  },
  in_preparation: {
    tone: 'blue',
    tile: 'border-blue-500 bg-blue-50 text-blue-950',
    tileLabel: 'bg-blue-200 text-blue-900',
  },
  ready: {
    tone: 'cyan',
    tile: 'border-cyan-600 bg-cyan-50 text-cyan-950',
    tileLabel: 'bg-cyan-200 text-cyan-950',
  },
  bill_requested: {
    tone: 'violet',
    tile: 'border-violet-600 bg-violet-50 text-violet-950',
    tileLabel: 'bg-violet-200 text-violet-950',
  },
  in_person_payment: {
    tone: 'red',
    tile: 'border-red-600 bg-red-50 text-red-950',
    tileLabel: 'bg-red-200 text-red-950',
  },
  payment_pending: {
    tone: 'rose',
    tile: 'border-rose-600 bg-rose-50 text-rose-950',
    tileLabel: 'bg-rose-200 text-rose-950',
  },
}

/**
 * Un color por estado de pedido, el mismo en el ticket, la fila del historial y
 * su detalle. Mientras el pedido está en curso, es el color que le da a su mesa en
 * el plano (ver `getPosTableState`): «Listo» es cian en el ticket y en la mesa, y
 * no índigo en uno y cian en la otra.
 */
export const orderStatusTone: Record<OrderStatus, BadgeColor> = {
  submitted: tableStateStyles.order_pending.tone,
  accepted: tableStateStyles.order_pending.tone,
  in_preparation: tableStateStyles.in_preparation.tone,
  ready: tableStateStyles.ready.tone,
  // Ya no dejan un estado en la mesa: entregado es lo terminado, y cancelado, lo que no se cobra.
  delivered: 'green',
  cancelled: 'red',
}

/**
 * El fondo de cada columna del tablero, de la familia de color de los pedidos que
 * junta: la columna «Listo» es cian como sus tickets. Lo entregado es lo que menos
 * se consulta durante el servicio y va neutro (además, se puede plegar).
 */
export const boardColumnStyles: Record<PosBoardColumnId, string> = {
  new: 'border-amber-200 bg-amber-50',
  in_preparation: 'border-blue-200 bg-blue-50',
  ready: 'border-cyan-200 bg-cyan-50',
  delivered: 'border-neutral-200 bg-neutral-50',
}

import { useQuery } from '@tanstack/react-query'
import { formatPrice, orderStatusLabels, parseSessionSplit, type Tables } from '@restaurant-platform/shared'
import { FreshnessNote } from '@/components/FreshnessNote'
import type { Announce } from '@/features/announcements'
import { BillSplitter } from '@/features/BillSplitter'
import { oldestUpdate } from '@/features/freshness'

import { loadBill, loadOrders } from '@/features/orders-api'
import type { loadSession } from '@/features/session'

type SessionData = Awaited<ReturnType<typeof loadSession>>
type Participant = Tables<'session_participants'>
type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]
type Bill = Awaited<ReturnType<typeof loadBill>>

type SessionOrdersProps = {
  sessionId?: string
  session?: SessionData
  participants: Participant[]
  userId?: string
  closed: boolean
  /** Avisos al comensal; los muestra el Toast de la mesa. */
  onAnnounce: Announce
  /** Repite un pedido en el carrito. Ausente cuando la mesa no admite pedir. */
  onReorder?: (order: Order) => void
}

export function SessionOrders({
  sessionId,
  session,
  participants,
  userId,
  closed,
  onAnnounce,
  onReorder,
}: SessionOrdersProps) {
  const orders = useQuery({
    queryKey: ['orders', sessionId],
    queryFn: () => loadOrders(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })
  const bill = useQuery({
    queryKey: ['bill', sessionId],
    queryFn: () => loadBill(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })

  const participantName = (id: string | null) => {
    const participant = participants.find((entry) => entry.id === id)
    const suffix = participant?.user_id === userId ? ' (vos)' : ''
    return `${participant?.display_name ?? 'Comensal'}${suffix}`
  }

  if (!sessionId) {
    return (
      <section>
        <h2>Pedidos y cuenta</h2>
        <p className="notice">Escaneá el QR de tu mesa para consultar sus pedidos y su cuenta.</p>
      </section>
    )
  }

  return (
    <section aria-label="Pedidos y cuenta de la mesa">
      <p className="eyebrow">TODOS EN LA MISMA MESA</p>
      <h2>Pedidos y cuenta</h2>
      <p className="muted">
        Los pedidos de todos los comensales se actualizan automáticamente.{' '}
        {closed && 'La mesa ya cerró su cuenta; podés seguir consultando el detalle.'}
      </p>

      <FreshnessNote
        label="los pedidos y la cuenta"
        updatedAt={oldestUpdate(orders.dataUpdatedAt, bill.dataUpdatedAt)}
        isFetching={orders.isFetching || bill.isFetching}
        onRefresh={() => {
          void orders.refetch()
          void bill.refetch()
        }}
      />

      {bill.isPending && <p role="status">Actualizando la cuenta…</p>}
      {bill.isError && (
        <div className="notice" role="alert">
          <p>No pudimos actualizar la cuenta.</p>
          <button onClick={() => { void bill.refetch() }}>Reintentar cuenta</button>
        </div>
      )}
      {bill.data && <BillSummary bill={bill.data} />}

      {orders.isPending && <p role="status">Cargando los pedidos…</p>}
      {orders.isError && (
        <div className="notice" role="alert">
          <p>No pudimos actualizar los pedidos.</p>
          <button onClick={() => { void orders.refetch() }}>Reintentar pedidos</button>
        </div>
      )}
      {orders.data?.length === 0 && (
        <p className="empty">Todavía no hay pedidos enviados en esta mesa.</p>
      )}
      {orders.data?.map((order, index) => (
        <OrderCard
          key={order.id}
          order={order}
          position={orders.data.length - index}
          participantName={participantName}
          onReorder={onReorder}
        />
      ))}
      {bill.data && session && participants.length > 0 && (
        <BillSplitter
          sessionId={session.id}
          split={parseSessionSplit(session.split_type, session.split_allocations)}
          bill={bill.data}
          orders={orders.data ?? []}
          participants={participants}
          userId={userId}
          updatedBy={session.split_updated_by}
          updatedAt={session.split_updated_at}
          onAnnounce={onAnnounce}
        />
      )}
    </section>
  )
}

function BillSummary({ bill }: { bill: Bill }) {
  // Cada cifra dice qué pasó con el pedido, no su estado contable, y lleva su
  // propia aclaración: el párrafo al pie obligaba a leerlo entero para entender
  // una sola de las cuatro.
  const figures = [
    {
      term: 'Esperando al restaurante',
      amount: bill.submitted_amount,
      hint: 'Ya lo enviaste; se suma a la cuenta cuando el restaurante lo recibe.',
    },
    {
      term: 'Ya en la cuenta',
      amount: bill.total_amount,
      hint: 'Lo que el restaurante aceptó. Lo cancelado no se cobra.',
    },
    {
      term: 'Pagado',
      amount: bill.paid_amount,
      hint: 'Solo los pagos ya aprobados.',
    },
    {
      term: 'Falta pagar',
      amount: bill.pending_amount,
      hint: 'Lo que está en la cuenta y todavía no se pagó.',
    },
  ]

  return (
    <div className="bill-panel" aria-label="Resumen de cuenta">
      <dl className="bill-grid">
        {figures.map(({ term, amount, hint }) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>
              {formatPrice(amount ?? 0)}
              <small>{hint}</small>
            </dd>
          </div>
        ))}
      </dl>
      {bill.is_settled && (bill.total_amount ?? 0) > 0 && <p className="settled">Cuenta pagada</p>}
    </div>
  )
}

function OrderCard({
  order,
  position,
  participantName,
  onReorder,
}: {
  order: Order
  /** Número del pedido dentro de la mesa, contando desde el primero. */
  position: number
  participantName: (id: string | null) => string
  onReorder?: (order: Order) => void
}) {
  const createdAt = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(order.created_at))

  return (
    <article className="order-card">
      <div className="order-heading">
        <h3>Pedido de {participantName(order.submitted_by)}</h3>
        <span className={`badge status-${order.status}`}>{orderStatusLabels[order.status]}</span>
      </div>
      <p className="muted">
        Pedido {position} de la mesa · {createdAt}
      </p>
      {order.status === 'submitted' && (
        <p className="muted">Esperando confirmación del restaurante. Aún no está en cuenta.</p>
      )}
      {order.status === 'cancelled' && (
        <p className="muted">Este pedido fue cancelado y no se cobra.</p>
      )}
      {order.order_items.map((item) => (
        <OrderLine key={item.id} item={item} participantName={participantName} />
      ))}
      {order.notes && <p>{order.notes}</p>}
      <div className="total">
        <span>Total del pedido</span>
        <strong>{formatPrice(order.total_amount)}</strong>
      </div>
      {/* La ronda es el caso típico: repetir lo mismo sin rearmarlo plato por plato. */}
      {onReorder && (
        <button onClick={() => onReorder(order)}>Pedir de nuevo</button>
      )}
    </article>
  )
}

function OrderLine({
  item,
  participantName,
}: {
  item: OrderItem
  participantName: (id: string | null) => string
}) {
  const owner = item.is_shared ? 'Para compartir en la mesa' : participantName(item.participant_id)

  return (
    <div className="order-line">
      <div className="order-heading">
        <h4>
          {item.quantity} × {item.product_name}
        </h4>
        <strong>{formatPrice(item.total_price)}</strong>
      </div>
      <p className="muted">
        {owner} · Base por unidad: {formatPrice(item.base_price)}
      </p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id}>
          + {modifier.group_name}: {modifier.option_name} ({formatPrice(modifier.price_delta)} por unidad)
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id}>Sin {ingredient.ingredient_name}</p>
      ))}
      {item.notes && <p>{item.notes}</p>}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { orderStatusLabels } from '@restaurant-platform/shared'
import type { Tables } from '@restaurant-platform/shared'
import { loadBill, loadOrders } from '@/features/orders-api'
import { money } from '@/features/menu'

type Participant = Tables<'session_participants'>
type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]
type Bill = Awaited<ReturnType<typeof loadBill>>

type SessionOrdersProps = {
  sessionId?: string
  participants: Participant[]
  userId?: string
  closed: boolean
}

export function SessionOrders({ sessionId, participants, userId, closed }: SessionOrdersProps) {
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
        <p className="notice">Conectate con tu mesa para consultar sus pedidos y cuenta.</p>
      </section>
    )
  }

  return (
    <section aria-label="Pedidos y cuenta de la mesa">
      <p className="eyebrow">TODOS EN LA MISMA MESA</p>
      <h2>Pedidos y cuenta</h2>
      <p className="muted">
        Los pedidos de todos los comensales se actualizan automáticamente.{' '}
        {closed && 'Esta sesión está cerrada; podés seguir consultando el detalle.'}
      </p>

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
      {orders.data?.map((order) => (
        <OrderCard key={order.id} order={order} participantName={participantName} />
      ))}
    </section>
  )
}

function BillSummary({ bill }: { bill: Bill }) {
  return (
    <div className="bill-panel" aria-label="Resumen de cuenta">
      <dl className="bill-grid">
        <div>
          <dt>Enviado, por confirmar</dt>
          <dd>{money(bill.submitted_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>En cuenta</dt>
          <dd>{money(bill.total_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pagado</dt>
          <dd>{money(bill.paid_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pendiente de pago</dt>
          <dd>{money(bill.pending_amount ?? 0)}</dd>
        </div>
      </dl>
      <p className="muted">
        Los pedidos aceptados por el restaurante forman parte de la cuenta. Los enviados esperan
        confirmación y los cancelados no se cobran. Pagado incluye únicamente pagos aprobados.
      </p>
      {bill.is_settled && (bill.total_amount ?? 0) > 0 && <p className="settled">Cuenta pagada</p>}
    </div>
  )
}

function OrderCard({
  order,
  participantName,
}: {
  order: Order
  participantName: (id: string | null) => string
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
        {createdAt} · #{order.id.slice(0, 8)}
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
        <strong>{money(order.total_amount)}</strong>
      </div>
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
        <h3>
          {item.quantity} × {item.product_name}
        </h3>
        <strong>{money(item.total_price)}</strong>
      </div>
      <p className="muted">
        {owner} · Base por unidad: {money(item.base_price)}
      </p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id}>
          + {modifier.group_name}: {modifier.option_name} ({money(modifier.price_delta)} por unidad)
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id}>Sin {ingredient.ingredient_name}</p>
      ))}
      {item.notes && <p>{item.notes}</p>}
    </div>
  )
}

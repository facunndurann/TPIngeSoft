import { useQuery } from '@tanstack/react-query'
import {
  formatPrice,
  orderStatusLabels,
  parseSessionSplit,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
} from '@restaurant-platform/shared'
import { FreshnessNote } from '@/components/FreshnessNote'
import { BillSplitter } from '@/features/BillSplitter'
import { plateCount } from '@/features/cart'
import { oldestUpdate } from '@/features/freshness'
import { MobilePayment } from '@/features/MobilePayment'
import {
  billQuery,
  type loadBill,
  type loadOrders,
  type loadPayments,
  ordersQuery,
  paymentsQuery,
} from '@/features/orders-api'
import { ServiceRequests } from '@/features/ServiceRequests'
import { useTable } from '@/features/table-context'

type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]
type Bill = Awaited<ReturnType<typeof loadBill>>
type Payment = Awaited<ReturnType<typeof loadPayments>>[number]

type SessionOrdersProps = {
  /** Repite un pedido en el carrito. Ausente cuando la mesa no admite pedir. */
  onReorder?: (order: Order) => void
}

export function SessionOrders({ onReorder }: SessionOrdersProps) {
  const { sessionId, session: sessionQuery, userId, paymentMethods } = useTable()
  const session = sessionQuery.data
  const participants = session?.participants ?? []
  const closed = session?.status === 'closed'
  // `parseSessionSplit` acepta lo que venga y cae en `none`: sin mesa leída no
  // hay división, y así el valor nunca es nulo para quien lo muestra.
  const sessionSplit = parseSessionSplit(
    session?.split_type,
    session?.split_allocations,
    session?.split_equal_parts,
  )

  const orders = useQuery(ordersQuery(sessionId))
  const bill = useQuery(billQuery(sessionId))
  const payments = useQuery(paymentsQuery(sessionId))

  const participantName = (id: string | null) => {
    const participant = participants.find((entry) => entry.id === id)
    const suffix = participant?.user_id === userId ? ' (vos)' : ''
    return `${participant?.display_name ?? 'Comensal'}${suffix}`
  }
  const currentParticipantId = participants.find(participant => participant.user_id === userId)?.id

  if (!sessionId) {
    return (
      <section>
        <h2>Pedidos</h2>
        <p className="notice">Escaneá el QR de tu mesa para consultar sus pedidos y su cuenta.</p>
      </section>
    )
  }

  return (
    <section aria-label="Pedidos de la mesa">
      <h2>Pedidos</h2>
      {closed && (
        <p className="muted">La mesa ya cerró su cuenta; podés seguir consultando el detalle.</p>
      )}

      <FreshnessNote
        label="los pedidos y la cuenta"
        updatedAt={oldestUpdate(orders.dataUpdatedAt, bill.dataUpdatedAt)}
        isFetching={orders.isFetching || bill.isFetching}
      />

      {bill.isPending && <p role="status">Actualizando la cuenta…</p>}
      {bill.isError && (
        <div className="notice" role="alert">
          <p>No pudimos actualizar la cuenta.</p>
          <button onClick={() => { void bill.refetch() }}>Reintentar cuenta</button>
        </div>
      )}
      {bill.data && <BillSummary bill={bill.data} />}
      {bill.data && session && currentParticipantId && paymentMethods.includes('mobile') && (
        <MobilePayment
          sessionId={session.id}
          pending={Number(bill.data.pending_amount ?? 0)}
          accountTotal={Number(bill.data.total_amount ?? 0)}
          participantId={currentParticipantId}
          participants={participants}
          payments={payments.data ?? []}
          closed={closed}
          split={sessionSplit}
          orders={orders.data ?? []}
          participantName={participantName}
        />
      )}
      <PaymentHistory
        payments={payments.data}
        loading={payments.isPending}
        error={payments.isError}
        participantName={participantName}
        retry={() => { void payments.refetch() }}
      />
      <ServiceRequests />

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
      {bill.data && (
        <BillSplitter split={sessionSplit} bill={bill.data} orders={orders.data ?? []} />
      )}
    </section>
  )
}

function PaymentHistory({
  payments,
  loading,
  error,
  participantName,
  retry,
}: {
  payments?: Payment[]
  loading: boolean
  error: boolean
  participantName: (id: string | null) => string
  retry: () => void
}) {
  if (loading) return <p role="status">Actualizando los pagos…</p>
  if (error) {
    return (
      <div className="notice" role="alert">
        <p>No pudimos actualizar el historial de pagos.</p>
        <button onClick={retry}>Reintentar pagos</button>
      </div>
    )
  }
  if (!payments?.length) return null

  return (
    <div className="bill-panel" aria-label="Historial de pagos">
      <h3>Pagos registrados</h3>
      {payments.map((payment) => (
        <div className="line" key={payment.id}>
          <div>
            <strong>{formatPrice(payment.amount)}</strong>{' '}
            <span>{paymentStatusLabels[payment.status]}</span>
            <p className="muted">
              {paymentMethodLabels[payment.method]} · {paymentModeLabels[payment.mode]}
              {payment.participant_id ? ` · ${participantName(payment.participant_id)}` : ''}
            </p>
          </div>
          <time dateTime={payment.created_at}>
            {new Intl.DateTimeFormat('es-AR', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            }).format(new Date(payment.created_at))}
          </time>
        </div>
      ))}
      <p className="muted">Los pagos pendientes o rechazados se muestran, pero no reducen el saldo.</p>
    </div>
  )
}

function BillSummary({ bill }: { bill: Bill }) {
  return (
    <div className="bill-panel" aria-label="Resumen de cuenta">
      <dl className="bill-due">
        <dt>Falta pagar</dt>
        <dd>{formatPrice(bill.pending_amount ?? 0)}</dd>
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

  const plates = order.order_items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <article className="order-card">
      {/* Cerrada por defecto: el resumen ya contesta de quién es, cuánto y cómo va;
          el detalle plato por plato se abre cuando alguien lo busca. */}
      <details className="order-details">
        <summary className="disclosure">
          <div className="order-summary">
            <div className="order-heading">
              <h3>Pedido {position}</h3>
              <span className={`badge status-${order.status}`}>{orderStatusLabels[order.status]}</span>
            </div>
            <p className="muted">
              {participantName(order.submitted_by)} · {plateCount(plates)} ·{' '}
              {formatPrice(order.total_amount)} · {createdAt}
            </p>
          </div>
          <span className="chevron" aria-hidden="true">›</span>
        </summary>

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
          <span>Total</span>
          <strong>{formatPrice(order.total_amount)}</strong>
        </div>
        {onReorder && (
          <button onClick={() => onReorder(order)}>Pedir de nuevo</button>
        )}
      </details>
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

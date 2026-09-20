import { useQuery } from '@tanstack/react-query'
import {
  formatPrice,
  orderStatusLabels,
  parseSessionSplit,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
  type PaymentMethod,
  type Tables,
} from '@restaurant-platform/shared'
import { BillSplitter } from '@/features/BillSplitter'
import { MobilePayment } from '@/features/MobilePayment'

import { loadBill, loadOrders, loadPayments } from '@/features/orders-api'
import type { loadSession } from '@/features/session'
import { ServiceRequests } from '@/features/ServiceRequests'

type SessionData = Awaited<ReturnType<typeof loadSession>>
type Participant = Tables<'session_participants'>
type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]
type Bill = Awaited<ReturnType<typeof loadBill>>
type Payment = Awaited<ReturnType<typeof loadPayments>>[number]

type SessionOrdersProps = {
  sessionId?: string
  session?: SessionData
  participants: Participant[]
  userId?: string
  closed: boolean
  paymentMethods: PaymentMethod[]
}

export function SessionOrders({
  sessionId,
  session,
  participants,
  userId,
  closed,
  paymentMethods,
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
  const payments = useQuery({
    queryKey: ['payments', sessionId],
    queryFn: () => loadPayments(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })

  const participantName = (id: string | null) => {
    const participant = participants.find((entry) => entry.id === id)
    const suffix = participant?.user_id === userId ? ' (vos)' : ''
    return `${participant?.display_name ?? 'Comensal'}${suffix}`
  }
  const currentParticipantId = participants.find(participant => participant.user_id === userId)?.id

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
      {bill.data && session && currentParticipantId && paymentMethods.includes('mobile') && (
        <MobilePayment
          sessionId={session.id}
          pending={Number(bill.data.pending_amount ?? 0)}
          participantId={currentParticipantId}
          payments={payments.data ?? []}
          closed={closed}
        />
      )}
      <PaymentHistory
        payments={payments.data}
        loading={payments.isPending}
        error={payments.isError}
        participantName={participantName}
        retry={() => { void payments.refetch() }}
      />
      {session && (
        <ServiceRequests
          sessionId={session.id}
          session={session}
          closed={closed}
          paymentMethods={paymentMethods}
        />
      )}

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
      {bill.data && session && participants.length > 0 && (
        <BillSplitter
          sessionId={session.id}
          split={parseSessionSplit(session.split_type, session.split_allocations)}
          bill={bill.data}
          orders={orders.data ?? []}
          participants={participants}
          userId={userId}
        />
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
      <dl className="bill-grid">
        <div>
          <dt>Enviado, por confirmar</dt>
          <dd>{formatPrice(bill.submitted_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>En cuenta</dt>
          <dd>{formatPrice(bill.total_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pagado</dt>
          <dd>{formatPrice(bill.paid_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pendiente de pago</dt>
          <dd>{formatPrice(bill.pending_amount ?? 0)}</dd>
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
        <strong>{formatPrice(order.total_amount)}</strong>
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

import { useQuery } from '@tanstack/react-query'
import {
  formatPrice,
  formatTableTime,
  parseSessionSplit,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
} from '@restaurant-platform/shared'
import { ErrorText, useNow } from '@restaurant-platform/ui'
import { FreshnessNote } from '@/components/FreshnessNote'
import { AddGuest } from '@/features/AddGuest'
import { BillSplitter } from '@/features/BillSplitter'
import { oldestUpdate } from '@/features/freshness'
import { MobilePayment } from '@/features/MobilePayment'
import { billQuery, type loadBill, type loadPayments, ordersQuery, paymentsQuery } from '@/features/orders-api'
import { ServiceRequests } from '@/features/ServiceRequests'
import { useTable } from '@/features/table-context'
import { WithoutSession } from '@/features/TableChrome'

type Bill = Awaited<ReturnType<typeof loadBill>>
type Payment = Awaited<ReturnType<typeof loadPayments>>[number]

/**
 * La cuenta de la mesa, en el orden en que se decide: cuánto falta, cómo se
 * reparte, quiénes pagan, pagar, lo que ya se pagó y, al final, llamar al mozo.
 * El pago lee la división de arriba, así que nunca aparece antes que ella.
 */
export function SessionBill() {
  const { sessionId, session: sessionQuery, me, closed, paymentMethods } = useTable()
  const session = sessionQuery.data
  const participants = session?.participants ?? []
  // `parseSessionSplit` acepta lo que venga y cae en `none`: sin mesa leída no
  // hay división, y así el valor nunca es nulo para quien lo muestra.
  const split = parseSessionSplit(
    session?.split_type,
    session?.split_allocations,
    session?.split_equal_parts,
  )

  const bill = useQuery(billQuery(sessionId))
  // Lo pedido lo necesitan «cada uno lo suyo», el pago por ítems y los invitados.
  // Es la misma consulta que la pestaña Pedidos: react-query la comparte.
  const orders = useQuery(ordersQuery(sessionId))
  const payments = useQuery(paymentsQuery(sessionId))

  if (!sessionId) return <WithoutSession title="Cuenta" subject="su cuenta" />

  const ordered = orders.data ?? []

  return (
    <section aria-label="Cuenta de la mesa">
      <h2>Cuenta</h2>
      {closed && (
        <p className="muted">La mesa ya cerró su cuenta; podés seguir consultando el detalle.</p>
      )}
      <FreshnessNote
        label="la cuenta"
        updatedAt={oldestUpdate(bill.dataUpdatedAt, orders.dataUpdatedAt, payments.dataUpdatedAt)}
        isFetching={bill.isFetching || orders.isFetching || payments.isFetching}
      />

      {bill.isPending && <p role="status">Cargando la cuenta…</p>}
      {/* Cada lectura dice qué falló (lo pone su loader) y el catálogo decide si reintentar. */}
      <ErrorText variant="menu" error={bill.error} retry={() => { void bill.refetch() }} />
      {bill.data && (
        <>
          <BillSummary bill={bill.data} />
          <BillSplitter split={split} bill={bill.data} orders={ordered} />
          {/* Con la mesa cerrada ya no se suma gente: la RPC lo rechazaría. */}
          {!closed && <AddGuest sessionId={sessionId} orders={ordered} />}
          {session && me && paymentMethods.includes('mobile') && (
            <MobilePayment
              sessionId={session.id}
              pending={Number(bill.data.pending_amount ?? 0)}
              accountTotal={Number(bill.data.total_amount ?? 0)}
              participantId={me.id}
              participants={participants}
              payments={payments.data ?? []}
              closed={closed}
              split={split}
              orders={ordered}
            />
          )}
        </>
      )}
      <PaymentHistory
        payments={payments.data}
        loading={payments.isPending}
        error={payments.error}
        retry={() => { void payments.refetch() }}
      />
      <ServiceRequests />
    </section>
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

function PaymentHistory({
  payments,
  loading,
  error,
  retry,
}: {
  payments?: Payment[]
  loading: boolean
  error: Error | null
  retry: () => void
}) {
  const { nameOf } = useTable()
  const now = useNow()
  if (loading) return <p role="status">Actualizando los pagos…</p>
  if (error) return <ErrorText variant="menu" error={error} retry={retry} />
  if (!payments?.length) return null

  return (
    <div className="bill-panel" aria-label="Historial de pagos">
      <h3>Pagos registrados</h3>
      {/* Cada pago en una fila: importe y estado a la izquierda, la hora a la derecha. */}
      <ul className="payment-list">
        {payments.map((payment) => (
          <li className="payment-line" key={payment.id}>
            <div>
              <strong>{formatPrice(payment.amount)}</strong> <span>{paymentStatusLabels[payment.status]}</span>
              <p className="muted">
                {paymentMethodLabels[payment.method]} · {paymentModeLabels[payment.mode]}
                {payment.participant_id ? ` · ${nameOf(payment.participant_id)}` : ''}
              </p>
            </div>
            <time className="muted" dateTime={payment.created_at}>
              {formatTableTime(payment.created_at, now)}
            </time>
          </li>
        ))}
      </ul>
      <p className="muted">Los pagos pendientes o rechazados se muestran, pero no reducen el saldo.</p>
    </div>
  )
}

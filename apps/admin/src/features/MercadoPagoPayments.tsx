import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatPrice, paymentStatusLabels } from '@restaurant-platform/shared'
import { Badge, Button, QueryView } from '@restaurant-platform/ui'
import { mobilePaymentsQuery } from '@/queries/mobile-payments'

const reviewReasons: Record<string, string> = {
  MULTIPLE_PROVIDER_PAYMENTS: 'Se detectó más de un cobro para este intento.',
  APPROVED_AFTER_SESSION_CLOSED: 'El pago se aprobó después del cierre de la cuenta.',
  APPROVED_EXCEEDS_BALANCE: 'El importe aprobado supera el saldo de la cuenta.',
  CHARGEBACK_REVIEW: 'Mercado Pago informó un contracargo.',
  REFUND_REVIEW: 'Mercado Pago informó un reintegro.',
  PAYMENT_IN_MEDIATION: 'El pago está en mediación.',
  UNEXPECTED_PROVIDER_TRANSITION: 'El proveedor informó un cambio que requiere revisión.',
  UNSUPPORTED_PROVIDER_STATUS: 'El estado informado requiere revisión.',
}

export function MercadoPagoPayments({ restaurantId }: { restaurantId: string }) {
  const [reviewOnly, setReviewOnly] = useState(false)
  const payments = useQuery(mobilePaymentsQuery(restaurantId, reviewOnly))

  return (
    <section
      aria-label="Seguimiento de pagos de Mercado Pago"
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-semibold text-neutral-900">Pagos de Mercado Pago</h2>
        <Button
          variant="secondary"
          disabled={payments.isFetching}
          onClick={() => {
            void payments.refetch()
          }}
        >
          {payments.isFetching ? 'Actualizando…' : 'Actualizar pagos'}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
        Solo pagos que requieren revisión
      </label>
      <QueryView query={payments} fallback="No pudimos cargar los pagos.">
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-muted">
              {reviewOnly ? 'No hay pagos marcados para revisión.' : 'Todavía no hay pagos desde el celular.'}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {rows.map((payment) => (
                <li key={payment.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{formatPrice(payment.amount)}</strong>
                    <Badge
                      color={payment.status === 'approved' ? 'green' : payment.status === 'pending' ? 'neutral' : 'red'}
                    >
                      {paymentStatusLabels[payment.status]}
                    </Badge>
                    {payment.reconciliation_issue && <Badge color="red">Requiere revisión</Badge>}
                    <time className="text-xs text-muted" dateTime={payment.updated_at}>
                      {new Date(payment.updated_at).toLocaleString('es-AR')}
                    </time>
                  </div>
                  <p className="text-sm text-muted">
                    Acreditado a la cuenta:{' '}
                    {formatPrice(payment.status === 'approved' ? payment.amount - payment.refunded_amount : 0)}
                    {payment.refunded_amount > 0 && ` · Reintegrado: ${formatPrice(payment.refunded_amount)}`}
                  </p>
                  {payment.reconciliation_issue && (
                    <p className="text-sm text-red-700">
                      {reviewReasons[payment.reconciliation_issue] ?? 'Este pago necesita revisión.'} Revisá el cobro en
                      tu cuenta de Mercado Pago antes de realizar ajustes.
                    </p>
                  )}
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">Referencias del pago</summary>
                    <dl className="mt-2 grid gap-1 break-all">
                      <div>
                        <dt className="inline font-medium">Pago: </dt>
                        <dd className="inline">{payment.id}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Cuenta: </dt>
                        <dd className="inline">{payment.session_id}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">ID en Mercado Pago: </dt>
                        <dd className="inline">{payment.mp_payment_id ?? 'Aún no registrado'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Estado en Mercado Pago: </dt>
                        <dd className="inline">{payment.provider_status ?? 'Sin respuesta todavía'}</dd>
                      </div>
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </section>
  )
}

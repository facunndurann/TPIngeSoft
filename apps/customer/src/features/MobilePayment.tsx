import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AppError, countLabel, formatPrice, type MobilePaymentResult } from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import {
  type PaymentPlanInput,
  type PaymentRequest,
  type PaymentShare,
  type PaymentStep,
  paymentPlan,
} from '@/features/mobile-payment'
import { runMobilePayment } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import {
  clearCheckoutAttempt,
  readCheckoutAttempt,
  saveCheckoutAttempt,
  type CheckoutAttempt,
} from '@/features/checkout-attempt'

type MobilePaymentProps = Omit<PaymentPlanInput, 'selected'> & { sessionId: string }

const coverageLabels = { approved: 'Pagado', pending: 'Pago pendiente' } as const
const resultCopy = {
  approved: 'Tu pago fue aprobado. Actualizamos la cuenta.',
  rejected: 'El pago fue rechazado. Podés volver a intentarlo.',
  cancelled: 'El pago fue cancelado. Podés volver a intentarlo.',
  pending: 'El pago sigue pendiente de confirmación.',
} as const

export function MobilePayment({ sessionId, ...account }: MobilePaymentProps) {
  const { refreshTable, nameOf } = useTable()
  const [attempt, setAttempt] = useState(() => readCheckoutAttempt(sessionId, account.participantId))
  const [result, setResult] = useState<MobilePaymentResult>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const plan = paymentPlan({ ...account, selected })
  const copy = shareCopy(plan.share)
  const pendingId = plan.step.kind === 'pending' ? plan.step.payment.id : attempt?.paymentId

  const forgetAttempt = useCallback(() => {
    clearCheckoutAttempt(sessionId, account.participantId)
    setAttempt(undefined)
    setSelected(new Set())
  }, [sessionId, account.participantId])

  // Nunca leemos status/payment_id de la URL: al volver, la cuenta identifica
  // el pago y el backend consulta al proveedor. También funciona tras recargar.
  const status = useQuery({
    queryKey: ['checkout-pro-status', sessionId, account.participantId, pendingId],
    enabled: !!pendingId,
    queryFn: async () => {
      const verified = await runMobilePayment({ action: 'status', paymentId: pendingId! })
      await refreshTable()
      return verified
    },
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error instanceof AppError && !query.state.error.retryable) return false
      return !query.state.data || query.state.data.status === 'pending' ? 15_000 : false
    },
  })

  useEffect(() => {
    if (!status.data) return
    setResult(status.data)
    if (status.data.status !== 'pending') forgetAttempt()
  }, [status.data, forgetAttempt])

  const start = useMutation({
    mutationFn: async (request: PaymentRequest) => {
      const next: CheckoutAttempt = attempt ?? {
        request: { action: 'create', sessionId, requestId: crypto.randomUUID(), ...request },
      }
      // Guardar antes de enviar permite repetir exactamente la misma solicitud,
      // incluso si se pierde la respuesta o se recarga durante el checkout.
      saveCheckoutAttempt(account.participantId, next)
      setAttempt(next)
      setResult(undefined)
      return { response: await runMobilePayment(next.request), attempt: next }
    },
    onSuccess: async ({ response, attempt: sent }) => {
      const next = { ...sent, paymentId: response.paymentId }
      saveCheckoutAttempt(account.participantId, next)
      setAttempt(next)
      setResult(response)
      if (response.status !== 'pending') forgetAttempt()
      await refreshTable()
      if (response.status === 'pending' && response.checkoutUrl) window.location.assign(response.checkoutUrl)
    },
    onError: async (error) => {
      // Una falla de red conserva el intento. Un rechazo definitivo permite
      // corregir la selección; el backend conserva la protección de duplicados.
      if (
        error instanceof AppError &&
        !error.retryable &&
        error.code !== 'PAYMENT_RECONCILIATION_REQUIRED' &&
        error.code !== 'PAYMENT_VERIFICATION_FAILED'
      ) {
        forgetAttempt()
      }
      await refreshTable()
    },
  })

  const toggleItem = (id: string) => {
    start.reset()
    setResult(undefined)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="bill-panel" aria-label="Pago electrónico">
      <h3>Pagar desde el celular</h3>
      {plan.items.length > 0 && (
        <fieldset
          className="payment-items"
          disabled={account.closed || !!attempt || start.isPending || plan.step.kind === 'pending'}
        >
          <legend>Elegir ítems para pagar</legend>
          {plan.items.map(({ item, coverage, selected: checked }) => (
            <label key={item.id} className="payment-item">
              <input type="checkbox" checked={checked} disabled={!!coverage} onChange={() => toggleItem(item.id)} />
              <span>
                <strong>
                  {item.quantity} × {item.product_name}
                </strong>
                <small>
                  {item.is_shared ? 'Compartido' : nameOf(item.participant_id)}
                  {coverage && ` · ${coverageLabels[coverage]}`}
                </small>
              </span>
              <strong>{formatPrice(item.total_price)}</strong>
            </label>
          ))}
          {plan.share.mode === 'custom' && (
            <p className="muted">
              {countLabel(plan.share.itemIds.length, 'ítem')} · Subtotal {formatPrice(plan.share.amount)}
            </p>
          )}
        </fieldset>
      )}
      {copy.help && <p className="muted">{copy.help}</p>}
      {result && result.status !== 'pending' && (
        <p role="status">
          {result.providerStatus === 'refunded' || result.providerStatus === 'charged_back'
            ? 'El pago fue reintegrado o revertido. Consultá con el restaurante antes de volver a pagar.'
            : resultCopy[result.status]}
        </p>
      )}
      {attempt && !pendingId ? (
        <button className="primary wide" disabled={start.isPending} onClick={() => start.mutate(attempt.request)}>
          {start.isPending ? 'Iniciando pago…' : 'Reintentar pago'}
        </button>
      ) : pendingId && plan.step.kind !== 'pending' ? (
        <div role="status">
          <p className="muted">Consultando tu pago anterior…</p>
          <button
            disabled={status.isFetching}
            onClick={() => {
              void status.refetch()
            }}
          >
            Actualizar estado
          </button>
        </div>
      ) : (
        <PaymentStepView
          step={plan.step}
          payLabel={copy.pay}
          starting={start.isPending}
          checking={status.isFetching}
          checkoutUrl={!account.closed && status.data?.status === 'pending' ? status.data.checkoutUrl : undefined}
          onPay={(request) => start.mutate(request)}
          onCheck={() => {
            void status.refetch()
          }}
        />
      )}
      <ErrorText variant="menu" error={status.error ?? (status.data ? null : start.error)} />
    </section>
  )
}

/**
 * Lo que se dice de la parte a pagar: de dónde sale el importe, si hace falta
 * explicarlo, y el botón que la inicia. Que el servidor vuelva a validar el
 * importe es un detalle nuestro, no algo que el comensal tenga que leer.
 */
function shareCopy(share: PaymentShare): { help?: string; pay: string } {
  switch (share.mode) {
    case 'custom':
      return { pay: `Pagar ítems · ${formatPrice(share.amount)}` }
    case 'equal_split':
      return {
        help: `Quedan ${countLabel(share.remainingParts, 'parte')} por pagar.`,
        pay: `Pagar mi parte · ${formatPrice(share.amount)}`,
      }
    case 'percentage_split':
      return {
        help: `Tu parte es el ${share.percentage}% de ${formatPrice(share.accountTotal)}: ${formatPrice(share.shareOfTotal)}.`,
        pay: `Pagar mi parte · ${formatPrice(share.amount)}`,
      }
    case 'full':
      return { pay: `Pagar ${formatPrice(share.amount)}` }
  }
}

function PaymentStepView({
  step,
  payLabel,
  starting,
  checking,
  checkoutUrl,
  onPay,
  onCheck,
}: {
  step: PaymentStep
  payLabel: string
  starting: boolean
  checking: boolean
  checkoutUrl?: string
  onPay: (request: PaymentRequest) => void
  onCheck: () => void
}) {
  switch (step.kind) {
    case 'pending':
      return (
        <>
          <p>
            Pago pendiente por <strong>{formatPrice(step.payment.amount)}</strong>.
          </p>
          <div className="cart-actions">
            <button disabled={checking} onClick={onCheck}>
              {checking ? 'Consultando…' : 'Actualizar estado'}
            </button>
            {checkoutUrl && (
              <button className="primary" disabled={checking} onClick={() => window.location.assign(checkoutUrl)}>
                Continuar en Mercado Pago
              </button>
            )}
          </div>
        </>
      )
    case 'exceeds':
      return (
        <p className="error-notice" role="alert">
          El subtotal elegido supera el saldo pendiente de {formatPrice(step.balance)}. Deseleccioná algún ítem.
        </p>
      )
    case 'payable':
      return (
        <button className="primary wide" disabled={starting} onClick={() => onPay(step.request)}>
          {starting ? 'Iniciando pago…' : payLabel}
        </button>
      )
    case 'partsReserved':
      return <p className="muted">Todas las partes disponibles ya tienen un pago esperando confirmación.</p>
    case 'sharePaid':
      return <p className="settled">Ya pagaste tu {step.percentage}% de la cuenta. El resto lo pagan los demás.</p>
    case 'nothing':
      return <p className="settled">No hay saldo disponible para pagar.</p>
  }
}

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { countLabel, formatPrice } from '@restaurant-platform/shared'
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

type MobilePaymentProps = Omit<PaymentPlanInput, 'selected'> & { sessionId: string }

type Outcome = 'approved' | 'rejected'

const coverageLabels = { approved: 'Pagado', pending: 'Pago pendiente' } as const

export function MobilePayment({ sessionId, ...account }: MobilePaymentProps) {
  const { refreshTable, nameOf } = useTable()
  // Clave de idempotencia del próximo pago: se renueva cuando cambia lo que se va a
  // pagar, así un reintento del mismo pago no crea otro.
  const requestId = useRef(crypto.randomUUID())
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const plan = paymentPlan({ ...account, selected })
  const copy = shareCopy(plan.share)

  const start = useMutation({
    mutationFn: (request: PaymentRequest) =>
      runMobilePayment({ action: 'create', sessionId, requestId: requestId.current, ...request }),
    onSuccess: refreshTable,
  })
  const confirm = useMutation({
    mutationFn: ({ paymentId, outcome }: { paymentId: string; outcome: Outcome }) =>
      runMobilePayment({ action: 'confirm', paymentId, outcome }),
    onSuccess: async () => {
      requestId.current = crypto.randomUUID()
      setSelected(new Set())
      await refreshTable()
    },
  })

  const toggleItem = (id: string) => {
    requestId.current = crypto.randomUUID()
    start.reset()
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="bill-panel" aria-label="Pago electrónico">
      <h3>Pagar desde el celular</h3>
      {plan.items.length > 0 && (
        <fieldset className="payment-items" disabled={account.closed || plan.step.kind === 'pending'}>
          <legend>Elegir ítems para pagar</legend>
          {plan.items.map(({ item, coverage, selected: checked }) => (
            <label key={item.id} className="payment-item">
              <input
                type="checkbox"
                checked={checked}
                disabled={!!coverage}
                onChange={() => toggleItem(item.id)}
              />
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
          <p className="muted">
            {plan.share.mode === 'custom'
              ? `${countLabel(plan.share.itemIds.length, 'ítem')} · Subtotal ${formatPrice(plan.share.amount)}`
              : 'Seleccioná uno o más ítems, o pagá según la división de la cuenta.'}
          </p>
        </fieldset>
      )}
      {copy.help && <p className="muted">{copy.help}</p>}
      <PaymentStepView
        step={plan.step}
        payLabel={copy.pay}
        starting={start.isPending}
        confirming={confirm.isPending}
        onPay={(request) => start.mutate(request)}
        onConfirm={(paymentId, outcome) => confirm.mutate({ paymentId, outcome })}
      />
      <ErrorText variant="menu" error={start.error ?? confirm.error} />
    </div>
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
  confirming,
  onPay,
  onConfirm,
}: {
  step: PaymentStep
  payLabel: string
  starting: boolean
  confirming: boolean
  onPay: (request: PaymentRequest) => void
  onConfirm: (paymentId: string, outcome: Outcome) => void
}) {
  switch (step.kind) {
    case 'pending':
      return (
        <>
          <p>
            Pago pendiente por <strong>{formatPrice(step.payment.amount)}</strong>.
          </p>
          <p className="muted">Simulador sandbox: elegí la respuesta del proveedor.</p>
          <div className="cart-actions">
            <button disabled={confirming} onClick={() => onConfirm(step.payment.id, 'rejected')}>
              Simular rechazo
            </button>
            <button
              className="primary"
              disabled={confirming}
              onClick={() => onConfirm(step.payment.id, 'approved')}
            >
              {confirming ? 'Confirmando…' : 'Simular aprobación'}
            </button>
          </div>
        </>
      )
    case 'exceeds':
      return (
        <p className="error-notice" role="alert">
          El subtotal elegido supera el saldo pendiente de {formatPrice(step.balance)}. Deseleccioná
          algún ítem.
        </p>
      )
    case 'payable':
      return (
        <button className="primary wide" disabled={starting} onClick={() => onPay(step.request)}>
          {starting ? 'Iniciando pago…' : payLabel}
        </button>
      )
    case 'partsReserved':
      return (
        <p className="muted">Todas las partes disponibles ya tienen un pago esperando confirmación.</p>
      )
    case 'sharePaid':
      return (
        <p className="settled">
          Ya pagaste tu {step.percentage}% de la cuenta. El resto lo pagan los demás.
        </p>
      )
    case 'nothing':
      return <p className="settled">No hay saldo disponible para pagar.</p>
  }
}

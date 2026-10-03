import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  asAmount,
  formatPrice,
  formatTableTime,
  hasAtMostTwoDecimals,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
  type PaymentMethod,
  toCents,
} from '@restaurant-platform/shared'
import { Button, ErrorText, Field, Input, QueryView, Select, useNow, useSaveErrors } from '@restaurant-platform/ui'
import { useCan, usePosScope } from '@/context/pos-context'
import { recordPosPayment, sessionPaymentsQuery, type PosOpenSession } from './queries'

type PaymentPanelProps = {
  sessionId: string
  pendingAmount: PosOpenSession['pending_amount']
  enabledMethods: PaymentMethod[]
}

/**
 * Por qué no se puede registrar el importe escrito, o `null` si se puede. Son
 * las mismas reglas que aplica `pos_record_payment`, en el mismo orden: el
 * motivo aparece junto al campo antes de que la base lo rechace.
 */
function amountProblem(value: string, pending: number): string | null {
  if (value.trim() === '') return 'Ingresá el importe a registrar.'
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return 'El importe tiene que ser mayor a cero.'
  if (!hasAtMostTwoDecimals(amount)) return 'Usá hasta dos decimales.'
  if (toCents(amount) > toCents(pending)) return `Supera el pendiente de ${formatPrice(pending)}.`
  return null
}

export function PaymentPanel({ sessionId, pendingAmount, enabledMethods }: PaymentPanelProps) {
  const scope = usePosScope()
  const can = useCan()
  const now = useNow()
  const errors = useSaveErrors()
  const pending = asAmount(pendingAmount)
  // Mobile lo confirma el proveedor, no la caja.
  const recordable: PaymentMethod[] = enabledMethods.filter((method) => method !== 'mobile')

  // Lo que eligió o escribió la caja; null es «no lo tocó». Lo que se muestra
  // se calcula en cada render: si otra caja cobra, el importe sugerido pasa al
  // pendiente nuevo sin pisar uno escrito a mano, y si el admin deshabilita el
  // medio elegido, se cae al primero que siga habilitado.
  const [amountDraft, setAmountDraft] = useState<string | null>(null)
  const [methodChoice, setMethodChoice] = useState<PaymentMethod | null>(null)
  const [reference, setReference] = useState('')
  const [amountLeft, setAmountLeft] = useState(false)

  const amount = amountDraft ?? pending.toFixed(2)
  const method: PaymentMethod | undefined =
    methodChoice && recordable.includes(methodChoice) ? methodChoice : recordable[0]

  const payments = useQuery(sessionPaymentsQuery(scope, sessionId))

  const record = useMutation(errors.saving('No pudimos registrar el pago.', {
    mutationFn: (payment: { amount: number; method: PaymentMethod }) =>
      recordPosPayment({ sessionId, ...payment, externalReference: reference.trim() || undefined }),
    // El cliente del POS ya releyó la cuenta: el importe vuelve a sugerir el
    // pendiente nuevo.
    onSuccess: () => {
      setAmountDraft(null)
      setAmountLeft(false)
      setReference('')
    },
  }))

  const numericAmount = Number(amount)
  const amountError = amountProblem(amount, pending)
  // Un campo vacío puede ser alguien que borró para escribir otro importe: ese
  // aviso espera a que deje el campo. Los demás hablan de un número ya escrito.
  const shownAmountError = amountError && (amount.trim() !== '' || amountLeft) ? amountError : undefined

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Pagos de la cuenta">
      <h2 className="text-sm font-semibold text-neutral-800">Pagos de la cuenta</h2>

      {can('payments.write') && pending > 0 && recordable.length > 0 && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!method || amountError) return
            errors.clear()
            record.mutate({ amount: numericAmount, method })
          }}
        >
          {/* Field marca el campo como inválido y lo describe con el motivo. */}
          <Field label="Importe" error={shownAmountError}>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              max={pending}
              step="0.01"
              value={amount}
              onChange={(event) => setAmountDraft(event.target.value)}
              onBlur={() => setAmountLeft(true)}
            />
          </Field>
          <Field label="Medio">
            <Select
              value={method}
              onChange={(event) =>
                setMethodChoice(recordable.find((entry) => entry === event.target.value) ?? null)
              }
            >
              {recordable.map((entry) => <option key={entry} value={entry}>{paymentMethodLabels[entry]}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Referencia (opcional)">
              <Input
                maxLength={200}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Recibo, transferencia o terminal"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <ErrorText error={errors.message} />
            <Button disabled={record.isPending || amountError !== null || !method}>
              {record.isPending ? 'Registrando…' : `Registrar ${formatPrice(numericAmount || 0)}`}
            </Button>
          </div>
        </form>
      )}

      {can('payments.write') && pending > 0 && recordable.length === 0 && (
        <p className="text-sm text-amber-800">No hay un medio presencial o externo habilitado para registrar el cobro.</p>
      )}

      <QueryView query={payments} fallback="No pudimos cargar el historial de pagos.">
        {(payments) =>
          // Una línea y no el recuadro de vacío: el historial es una parte chica del panel.
          payments.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-neutral-900">
                      {formatPrice(payment.amount)} · {paymentStatusLabels[payment.status]}
                    </p>
                    <p className="text-xs text-muted">
                      {paymentMethodLabels[payment.method]} · {paymentModeLabels[payment.mode]}
                      {payment.external_reference ? ` · Ref. ${payment.external_reference}` : ''}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-muted" dateTime={payment.created_at}>
                    {formatTableTime(payment.created_at, now)}
                  </time>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </section>
  )
}

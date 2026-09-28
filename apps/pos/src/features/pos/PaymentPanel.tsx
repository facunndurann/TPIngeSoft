import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  asAmount,
  formatPrice,
  formatTableTime,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
  type PaymentMethod,
} from '@restaurant-platform/shared'
import { Button, ErrorText, Field, Input, Select, useNow, useSaveErrors } from '@restaurant-platform/ui'
import { useCan, useRestaurant } from '@/context/pos-context'
import { recordPosPayment, sessionPaymentsQuery, type PosOpenSession } from './queries'

type PaymentPanelProps = {
  sessionId: string
  pendingAmount: PosOpenSession['pending_amount']
  enabledMethods: PaymentMethod[]
}

export function PaymentPanel({ sessionId, pendingAmount, enabledMethods }: PaymentPanelProps) {
  const restaurant = useRestaurant()
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

  const amount = amountDraft ?? pending.toFixed(2)
  const method: PaymentMethod | undefined =
    methodChoice && recordable.includes(methodChoice) ? methodChoice : recordable[0]

  const payments = useQuery(sessionPaymentsQuery(restaurant.id, restaurant.branchId, sessionId))

  const record = useMutation(errors.saving('No pudimos registrar el pago.', {
    mutationFn: (payment: { amount: number; method: PaymentMethod }) =>
      recordPosPayment({ sessionId, ...payment, externalReference: reference.trim() || undefined }),
    // El cliente del POS ya releyó la cuenta: el importe vuelve a sugerir el
    // pendiente nuevo.
    onSuccess: () => {
      setAmountDraft(null)
      setReference('')
    },
  }))

  const numericAmount = Number(amount)
  const invalidAmount = !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > pending

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Pagos de la cuenta">
      <div>
        <h2 className="text-sm font-semibold text-neutral-800">Pagos de la cuenta</h2>
        <p className="text-xs text-neutral-500">Sólo los pagos aprobados descuentan del pendiente.</p>
      </div>

      {can('payments.write') && pending > 0 && recordable.length > 0 && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!method || invalidAmount) return
            errors.clear()
            record.mutate({ amount: numericAmount, method })
          }}
        >
          <Field label="Importe">
            <Input
              type="number"
              min="0.01"
              max={pending}
              step="0.01"
              value={amount}
              onChange={(event) => setAmountDraft(event.target.value)}
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
            <Button disabled={record.isPending || invalidAmount || !method}>
              {record.isPending ? 'Registrando…' : `Registrar ${formatPrice(numericAmount || 0)}`}
            </Button>
          </div>
        </form>
      )}

      {can('payments.write') && pending > 0 && recordable.length === 0 && (
        <p className="text-sm text-amber-800">No hay un medio presencial o externo habilitado para registrar el cobro.</p>
      )}

      {payments.isError && <ErrorText error={payments.error} fallback="No pudimos cargar el historial de pagos." />}
      {payments.data?.length === 0 && <p className="text-sm text-neutral-500">Todavía no hay pagos registrados.</p>}
      {(payments.data?.length ?? 0) > 0 && (
        <ul className="divide-y divide-neutral-100 text-sm">
          {payments.data?.map((payment) => (
            <li key={payment.id} className="flex items-start justify-between gap-3 py-2">
              <div>
                <p className="font-medium text-neutral-900">
                  {formatPrice(payment.amount)} · {paymentStatusLabels[payment.status]}
                </p>
                <p className="text-xs text-neutral-500">
                  {paymentMethodLabels[payment.method]} · {paymentModeLabels[payment.mode]}
                  {payment.external_reference ? ` · Ref. ${payment.external_reference}` : ''}
                </p>
              </div>
              <time className="shrink-0 text-xs text-neutral-500" dateTime={payment.created_at}>
                {formatTableTime(payment.created_at, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

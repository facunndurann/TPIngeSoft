import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  asAmount,
  formatPrice,
  paymentMethodLabels,
  paymentModeLabels,
  paymentStatusLabels,
  type PaymentMethod,
} from '@restaurant-platform/shared'
import { Button, ErrorText, useSaveErrors } from '@restaurant-platform/ui'
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
  const errors = useSaveErrors()
  const pending = asAmount(pendingAmount)
  const recordable: PaymentMethod[] = enabledMethods.filter((method) => method !== 'mobile')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod | ''>(recordable[0] ?? '')
  const [reference, setReference] = useState('')

  useEffect(() => {
    setAmount(pending > 0 ? pending.toFixed(2) : '')
  }, [pending])

  useEffect(() => {
    if (!method || !recordable.includes(method)) setMethod(recordable[0] ?? '')
  }, [method, recordable])

  const payments = useQuery(sessionPaymentsQuery(restaurant.id, restaurant.branchId, sessionId))

  const record = useMutation(errors.saving('No pudimos registrar el pago.', {
    mutationFn: () => {
      const numericAmount = Number(amount)
      return recordPosPayment({
        sessionId,
        amount: numericAmount,
        method: method as PaymentMethod,
        mode: numericAmount === pending ? 'full' : 'custom',
        externalReference: reference.trim() || undefined,
      })
    },
    onSuccess: () => setReference(''),
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
          onSubmit={(event) => { event.preventDefault(); errors.clear(); record.mutate() }}
        >
          <label className="space-y-1 text-sm">
            <span className="font-medium text-neutral-700">Importe</span>
            <input
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              type="number"
              min="0.01"
              max={pending}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-neutral-700">Medio</span>
            <select
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {recordable.map((entry) => <option key={entry} value={entry}>{paymentMethodLabels[entry]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium text-neutral-700">Referencia (opcional)</span>
            <input
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              maxLength={200}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Recibo, transferencia o terminal"
            />
          </label>
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
              <time className="text-xs text-neutral-500" dateTime={payment.created_at}>
                {new Intl.DateTimeFormat('es-AR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                }).format(new Date(payment.created_at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

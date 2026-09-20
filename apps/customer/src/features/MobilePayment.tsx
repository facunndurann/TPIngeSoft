import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatPrice, splitEqualAmounts, type SessionSplit, type Tables } from '@restaurant-platform/shared'
import { runMobilePayment } from './orders-api'

type Payment = Pick<Tables<'payments'>, 'id'|'participant_id'|'amount'|'method'|'mode'|'status'>

export function MobilePayment({
  sessionId, pending, participantId, payments, closed, split,
}: {
  sessionId: string
  pending: number
  participantId: string
  payments: Payment[]
  closed: boolean
  split: SessionSplit
}) {
  const client=useQueryClient()
  const requestId=useRef(crypto.randomUUID())
  const ownPending=payments.find(payment => payment.participant_id===participantId
    && payment.method==='mobile' && payment.status==='pending')
  const allocatedEqualPayments=payments.filter(payment =>
    payment.mode==='equal_split' && (payment.status==='approved' || payment.status==='pending'))
  const reservedEqualAmount=allocatedEqualPayments
    .filter(payment => payment.status==='pending')
    .reduce((total,payment) => total+Number(payment.amount),0)
  const remainingParts=split.type==='equal' && split.equalParts
    ? Math.max(1,split.equalParts-allocatedEqualPayments.length)
    : 1
  const paymentMode=split.type==='equal' ? 'equal_split' : 'full'
  const availableEqualBalance=Math.max(0,pending-reservedEqualAmount)
  const nextAmount=paymentMode==='equal_split'
    ? splitEqualAmounts({pending_amount:availableEqualBalance},remainingParts)[0] ?? availableEqualBalance
    : pending
  const refresh=async () => {
    await Promise.all([
      client.invalidateQueries({queryKey:['bill',sessionId]}),
      client.invalidateQueries({queryKey:['payments',sessionId]}),
      client.invalidateQueries({queryKey:['session',sessionId]}),
    ])
  }
  const start=useMutation({
    mutationFn:() => runMobilePayment({
      action:'create',sessionId,requestId:requestId.current,mode:paymentMode,
    }),
    onSuccess:refresh,
  })
  const confirm=useMutation({
    mutationFn:(outcome:'approved'|'rejected') => runMobilePayment({
      action:'confirm',paymentId:ownPending!.id,outcome,
    }),
    onSuccess:async () => { requestId.current=crypto.randomUUID(); await refresh() },
  })
  const error=start.error??confirm.error

  return (
    <div className="bill-panel" aria-label="Pago electrónico">
      <h3>Pagar desde el celular</h3>
      <p className="muted">
        {paymentMode==='equal_split'
          ? `Quedan ${remainingParts} ${remainingParts===1?'parte':'partes'} por pagar. El importe se calcula y valida en el servidor.`
          : 'El importe se calcula y valida en el servidor.'}
      </p>
      {ownPending ? (
        <>
          <p>Pago pendiente por <strong>{formatPrice(ownPending.amount)}</strong>.</p>
          <p className="muted">Simulador sandbox: elegí la respuesta del proveedor.</p>
          <div className="cart-actions">
            <button disabled={confirm.isPending} onClick={() => confirm.mutate('rejected')}>Simular rechazo</button>
            <button className="primary" disabled={confirm.isPending} onClick={() => confirm.mutate('approved')}>
              {confirm.isPending?'Confirmando…':'Simular aprobación'}
            </button>
          </div>
        </>
      ) : pending>0 && !closed && nextAmount>0 ? (
        <button className="primary wide" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending?'Iniciando pago…':paymentMode==='equal_split'
            ? `Pagar mi parte · ${formatPrice(nextAmount)}`
            : `Pagar ${formatPrice(pending)}`}
        </button>
      ) : paymentMode==='equal_split' && pending>0 && !closed ? (
        <p className="muted">Todas las partes disponibles ya tienen un pago esperando confirmación.</p>
      ) : (
        <p className="settled">No hay saldo disponible para pagar.</p>
      )}
      {error && <p className="notice" role="alert">{error.message}</p>}
    </div>
  )
}

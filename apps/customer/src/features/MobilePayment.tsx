import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatPrice, type Tables } from '@restaurant-platform/shared'
import { runMobilePayment } from './orders-api'

type Payment = Pick<Tables<'payments'>, 'id'|'participant_id'|'amount'|'method'|'status'>

export function MobilePayment({
  sessionId, pending, participantId, payments, closed,
}: {
  sessionId: string
  pending: number
  participantId: string
  payments: Payment[]
  closed: boolean
}) {
  const client=useQueryClient()
  const requestId=useRef(crypto.randomUUID())
  const ownPending=payments.find(payment => payment.participant_id===participantId
    && payment.method==='mobile' && payment.status==='pending')
  const refresh=async () => {
    await Promise.all([
      client.invalidateQueries({queryKey:['bill',sessionId]}),
      client.invalidateQueries({queryKey:['payments',sessionId]}),
      client.invalidateQueries({queryKey:['session',sessionId]}),
    ])
  }
  const start=useMutation({
    mutationFn:() => runMobilePayment({action:'create',sessionId,requestId:requestId.current}),
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
      <p className="muted">El importe se calcula y valida en el servidor.</p>
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
      ) : pending>0 && !closed ? (
        <button className="primary wide" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending?'Iniciando pago…':`Pagar ${formatPrice(pending)}`}
        </button>
      ) : (
        <p className="settled">No hay saldo disponible para pagar.</p>
      )}
      {error && <p className="notice" role="alert">{error.message}</p>}
    </div>
  )
}

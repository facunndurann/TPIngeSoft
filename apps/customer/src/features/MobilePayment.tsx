import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { formatPrice, isBilledStatus, type OrderStatus, type SessionSplit, splitEqualAmounts, splitPercentageAmounts, type SplitParticipant, type Tables } from '@restaurant-platform/shared'
import { runMobilePayment } from './orders-api'
import { useTable } from './table-context'

type Payment = Pick<Tables<'payments'>, 'id'|'participant_id'|'amount'|'method'|'mode'|'status'> & {
  payment_order_items: { order_item_id: string }[]
}
type PayableOrder = {
  status: OrderStatus
  order_items: {
    id: string
    product_name: string
    quantity: number
    total_price: number
    participant_id: string | null
    is_shared: boolean
  }[]
}

export function MobilePayment({
  sessionId, pending, accountTotal, participantId, participants, payments, closed, split, orders,
  participantName,
}: {
  sessionId: string
  pending: number
  /** Total en cuenta: es la base del porcentaje, no el pendiente (MI-43). */
  accountTotal: number
  participantId: string
  participants: readonly SplitParticipant[]
  payments: Payment[]
  closed: boolean
  split: SessionSplit
  orders: PayableOrder[]
  participantName: (id: string | null) => string
}) {
  const {refreshTable}=useTable()
  const requestId=useRef(crypto.randomUUID())
  const [selected,setSelected]=useState<Set<string>>(() => new Set())
  const ownPending=payments.find(payment => payment.participant_id===participantId
    && payment.method==='mobile' && payment.status==='pending')
  const unavailableItems=new Map<string,'pending'|'approved'>()
  for (const payment of payments) {
    if (payment.status!=='pending' && payment.status!=='approved') continue
    for (const item of payment.payment_order_items) unavailableItems.set(item.order_item_id,payment.status)
  }
  const payableItems=orders.filter(order => isBilledStatus(order.status)).flatMap(order => order.order_items)
  const selectedItems=payableItems.filter(item => selected.has(item.id) && !unavailableItems.has(item.id))
  const allocatedEqualPayments=payments.filter(payment =>
    payment.mode==='equal_split' && (payment.status==='approved' || payment.status==='pending'))
  const reservedEqualAmount=allocatedEqualPayments
    .filter(payment => payment.status==='pending')
    .reduce((total,payment) => total+Number(payment.amount),0)
  const remainingParts=split.type==='equal' && split.equalParts
    ? Math.max(1,split.equalParts-allocatedEqualPayments.length)
    : 1
  const paymentMode=selectedItems.length>0 ? 'custom'
    : split.type==='equal' ? 'equal_split'
    : split.type==='percentages' ? 'percentage_split'
    : 'full'
  const availableEqualBalance=Math.max(0,pending-reservedEqualAmount)
  // MI-43: el porcentaje se aplica al total de la cuenta, y de ahí se descuenta
  // lo que este comensal ya pagó. Misma regla que session_percentage_share, que
  // es la que manda: acá solo se muestra el importe antes de iniciarlo.
  const ownPercentage=split.type==='percentages' ? split.allocations[participantId] ?? 0 : 0
  const ownShare=split.type==='percentages'
    ? splitPercentageAmounts(accountTotal,participants,split.allocations)
      .find(share => share.participantId===participantId)?.amount ?? 0
    : 0
  const settledByOwner=payments
    .filter(payment => payment.participant_id===participantId && payment.status==='approved')
    .reduce((total,payment) => total+Number(payment.amount),0)
  const nextAmount=paymentMode==='custom'
    ? selectedItems.reduce((total,item) => total+Number(item.total_price),0)
    : paymentMode==='equal_split'
    ? splitEqualAmounts({pending_amount:availableEqualBalance},remainingParts)[0] ?? availableEqualBalance
    : paymentMode==='percentage_split'
    ? Math.min(Math.max(ownShare-settledByOwner,0),pending)
    : pending
  const toggleItem=(id:string) => {
    requestId.current=crypto.randomUUID()
    start.reset()
    setSelected(current => {
      const next=new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const start=useMutation({
    mutationFn:() => runMobilePayment({
      action:'create',sessionId,requestId:requestId.current,mode:paymentMode,
      ...(paymentMode==='custom' ? {itemIds:selectedItems.map(item => item.id)} : {}),
    }),
    onSuccess:refreshTable,
  })
  const confirm=useMutation({
    mutationFn:(outcome:'approved'|'rejected') => runMobilePayment({
      action:'confirm',paymentId:ownPending!.id,outcome,
    }),
    onSuccess:async () => {
      requestId.current=crypto.randomUUID()
      setSelected(new Set())
      await refreshTable()
    },
  })
  const error=start.error??confirm.error

  return (
    <div className="bill-panel" aria-label="Pago electrónico">
      <h3>Pagar desde el celular</h3>
      {payableItems.length>0 && (
        <fieldset className="payment-items" disabled={closed || !!ownPending}>
          <legend>Elegir ítems para pagar</legend>
          {payableItems.map(item => {
            const coverage=unavailableItems.get(item.id)
            const owner=item.is_shared?'Compartido':participantName(item.participant_id)
            return (
              <label key={item.id} className="payment-item">
                <input
                  type="checkbox"
                  checked={!coverage && selected.has(item.id)}
                  disabled={!!coverage}
                  onChange={() => toggleItem(item.id)}
                />
                <span>
                  <strong>{item.quantity} × {item.product_name}</strong>
                  <small>{owner}{coverage ? ` · ${coverage==='approved'?'Pagado':'Pago pendiente'}` : ''}</small>
                </span>
                <strong>{formatPrice(item.total_price)}</strong>
              </label>
            )
          })}
          <p className="muted">
            {selectedItems.length>0
              ? `${selectedItems.length} ${selectedItems.length===1?'ítem':'ítems'} · Subtotal ${formatPrice(nextAmount)}`
              : 'Seleccioná uno o más ítems, o usá la división configurada debajo.'}
          </p>
        </fieldset>
      )}
      <p className="muted">
        {paymentMode==='custom'
          ? 'El servidor vuelve a validar los ítems y su subtotal antes de crear el pago.'
          : paymentMode==='equal_split'
          ? `Quedan ${remainingParts} ${remainingParts===1?'parte':'partes'} por pagar. El importe se calcula y valida en el servidor.`
          : paymentMode==='percentage_split'
          ? `Tu parte es el ${ownPercentage}% de ${formatPrice(accountTotal)}: ${formatPrice(ownShare)}. El importe se calcula y valida en el servidor.`
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
      ) : paymentMode==='custom' && nextAmount>pending ? (
        <p className="notice" role="alert">
          El subtotal elegido supera el saldo pendiente de {formatPrice(pending)}. Deseleccioná algún ítem.
        </p>
      ) : pending>0 && !closed && nextAmount>0 ? (
        <button className="primary wide" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending?'Iniciando pago…':paymentMode==='custom'
            ? `Pagar ítems · ${formatPrice(nextAmount)}`
            : paymentMode==='equal_split' || paymentMode==='percentage_split'
            ? `Pagar mi parte · ${formatPrice(nextAmount)}`
            : `Pagar ${formatPrice(pending)}`}
        </button>
      ) : paymentMode==='equal_split' && pending>0 && !closed ? (
        <p className="muted">Todas las partes disponibles ya tienen un pago esperando confirmación.</p>
      ) : paymentMode==='percentage_split' && pending>0 && !closed ? (
        <p className="settled">Ya pagaste tu {ownPercentage}% de la cuenta. El resto lo pagan los demás.</p>
      ) : (
        <p className="settled">No hay saldo disponible para pagar.</p>
      )}
      {error && <p className="notice" role="alert">{error.message}</p>}
    </div>
  )
}

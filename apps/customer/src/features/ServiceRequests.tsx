import { useMutation } from '@tanstack/react-query'
import { formatElapsed, type SessionRequestState, sessionRequestState } from '@restaurant-platform/shared'
import { ErrorText, useNow } from '@restaurant-platform/ui'

import { requestSessionService } from '@/features/orders-api'
import { serviceRequestCopy } from '@/features/service-requests'
import { useTable } from '@/features/table-context'

/**
 * El único aviso que el comensal le manda al salón: que un mozo venga a cobrar a
 * la mesa (MI-46). Pedir la cuenta sigue existiendo en la base y en el POS, pero
 * esta pantalla ya no lo ofrece.
 */
const kind = 'in_person_payment'
const copy = serviceRequestCopy[kind]

export function ServiceRequests() {
  const { session: sessionQuery, closed, paymentMethods, refreshTable } = useTable()
  const session = sessionQuery.data

  const ask = useMutation({
    mutationFn: (sessionId: string) => requestSessionService(sessionId, kind),
    onSuccess: refreshTable,
  })

  if (!session) return null
  const state = sessionRequestState(session, kind)
  const paid = state.status === 'attended'
  // Cobrar en la mesa depende de que la sucursal lo tenga habilitado (MI-48).
  const offered = paymentMethods.includes('in_person')

  // Cobrada la mesa, la confirmación queda aunque ya haya cerrado. Sin cobrar, una
  // mesa cerrada no llama a nadie, y un local que no cobra en la mesa no lo ofrece;
  // un aviso ya en curso se sigue viendo, porque el salón también lo sigue viendo.
  if (!paid && (closed || (state.status === 'idle' && !offered))) return null

  return (
    <section className="bill-panel" aria-label="Atención en tu mesa">
      <h3>{paid ? '¡Gracias por tu visita!' : '¿Terminaron?'}</h3>
      <RequestStatus
        state={state}
        asking={ask.isPending}
        // Con pago desde el celular, pagar es la acción principal de la Cuenta y el
        // mozo, la alternativa: un solo botón primario por pantalla.
        primary={!paymentMethods.includes('mobile')}
        onAsk={() => ask.mutate(session.id)}
      />
      {!paid && paymentMethods.includes('external') && (
        <p className="muted">También podés pagar en caja.</p>
      )}
      <ErrorText variant="menu" error={ask.error} />
    </section>
  )
}

/** Pedir es un gesto de una sola vez: el botón da paso a la espera, y la espera a la confirmación. */
function RequestStatus({
  state,
  asking,
  primary,
  onAsk,
}: {
  state: SessionRequestState
  asking: boolean
  primary: boolean
  onAsk: () => void
}) {
  const now = useNow()

  switch (state.status) {
    case 'idle':
      return (
        <>
          <p className="muted">{copy.help}</p>
          <button className={primary ? 'primary wide' : 'wide'} disabled={asking} onClick={onAsk}>
            {asking ? 'Avisando…' : copy.action}
          </button>
        </>
      )
    case 'waiting':
      return (
        <>
          <p className="muted">
            {copy.waiting} · {formatElapsed(state.since, now)}
          </p>
          <strong className="settled">Avisado</strong>
        </>
      )
    case 'attended':
      return (
        <>
          <p>{copy.attended}</p>
          <small className="muted">{formatElapsed(state.at, now)}</small>
        </>
      )
  }
}

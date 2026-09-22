import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  formatElapsed,
  type SessionRequestKind,
  sessionRequestKinds,
  sessionRequestState,
} from '@restaurant-platform/shared'
import { useNow } from '@restaurant-platform/ui'

import { requestSessionService } from '@/features/orders-api'
import { serviceRequestCopy, serviceRequestMethod } from '@/features/service-requests'
import { useTable } from '@/features/table-context'

export function ServiceRequests() {
  const { session: sessionQuery, paymentMethods } = useTable()
  const queryClient = useQueryClient()
  const now = useNow()
  const session = sessionQuery.data

  const ask = useMutation({
    mutationFn: ({ sessionId, kind }: { sessionId: string; kind: SessionRequestKind }) =>
      requestSessionService(sessionId, kind),
    onSuccess: (_result, { sessionId }) =>
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] }),
  })

  if (!session) return null
  const closed = session.status === 'closed'

  const offered = (kind: SessionRequestKind) => {
    const method = serviceRequestMethod[kind]
    return method === null || paymentMethods.includes(method)
  }

  // Solo procesamos el tipo 'in_person_payment', filtrando la cuenta
  const entries = sessionRequestKinds
    .filter((kind) => kind === 'in_person_payment')
    .map((kind) => ({
      kind,
      copy: serviceRequestCopy[kind],
      state: sessionRequestState(session, kind),
    }))
    .filter((entry) => entry.state.status !== 'idle' || offered(entry.kind))

  const paid = sessionRequestState(session, 'in_person_payment').status === 'attended'
  const done = paid || closed
  const visible = paid
    ? entries.filter((entry) => entry.kind === 'in_person_payment')
    : done
      ? entries.filter((entry) => entry.state.status === 'attended')
      : entries

  if (visible.length === 0) return null

  return (
    <section className="bill-panel" aria-label="Atención en tu mesa">
      <h3>{paid ? '¡Gracias por tu visita!' : closed ? 'Atención en tu mesa' : '¿Terminaron?'}</h3>

      {visible.map(({ kind, copy, state }) => (
        <div key={kind}>
          {state.status === 'waiting' && (
            <>
              <p className="muted">
                {copy.waiting} · {formatElapsed(state.since, now)}
              </p>
              <strong className="settled">Avisado</strong>
            </>
          )}
          {state.status === 'attended' && (
            <>
              <p>{copy.attended}</p>
              <small className="muted">{formatElapsed(state.at, now)}</small>
            </>
          )}
          {state.status === 'idle' && (
            <>
              <p className="muted">{copy.help}</p>
              {offered(kind) && (
                <button
                  className="primary wide"
                  disabled={ask.isPending}
                  onClick={() => ask.mutate({ sessionId: session.id, kind })}
                >
                  {ask.isPending && ask.variables?.kind === kind ? 'Avisando…' : copy.action}
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {!done && paymentMethods.includes('external') && (
        <p className="muted">También podés pagar en caja.</p>
      )}

      {ask.isError && (
        <p className="notice" role="alert">
          {ask.error.message}
        </p>
      )}
    </section>
  )
}

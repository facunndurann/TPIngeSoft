import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  formatElapsed,
  type PaymentMethod,
  type SessionRequestKind,
  sessionRequestKinds,
  type SessionRequestSource,
  sessionRequestState,
} from '@restaurant-platform/shared'

import { useNow } from '@/features/clock'
import { requestSessionService } from '@/features/orders-api'
import { serviceRequestCopy, serviceRequestMethod } from '@/features/service-requests'

type ServiceRequestsProps = {
  sessionId: string
  /** La sesión guardada: sus fechas dicen qué pidió la mesa y qué ya le atendieron. */
  session: SessionRequestSource
  closed: boolean
  /** Medios habilitados en la sucursal (MI-48), en el orden del catálogo. */
  paymentMethods: PaymentMethod[]
}

/**
 * Avisos de la mesa al salón (MI-38/MI-46) y su respuesta. Pedir es un gesto de
 * una sola vez: mientras la solicitud está viva el botón se reemplaza por desde
 * cuándo espera la mesa, y cuando el salón la atiende queda la confirmación en
 * su lugar. Esa confirmación la guarda la sesión, no la pantalla: sigue ahí si
 * el comensal recargó, entró desde otro teléfono o estaba mirando la carta.
 */
export function ServiceRequests({
  sessionId,
  session,
  closed,
  paymentMethods,
}: ServiceRequestsProps) {
  const queryClient = useQueryClient()
  const now = useNow()

  const ask = useMutation({
    mutationFn: (kind: SessionRequestKind) => requestSessionService(sessionId, kind),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', sessionId] }),
  })

  // El local puede no ofrecer un medio; el aviso que ya está en curso se sigue
  // viendo igual, porque el salón también lo sigue viendo.
  const offered = (kind: SessionRequestKind) => {
    const method = serviceRequestMethod[kind]
    return method === null || paymentMethods.includes(method)
  }

  const entries = sessionRequestKinds
    .map((kind) => ({
      kind,
      copy: serviceRequestCopy[kind],
      state: sessionRequestState(session, kind),
    }))
    .filter((entry) => entry.state.status !== 'idle' || offered(entry.kind))

  // Cobrada la mesa, el comensal terminó: no tiene sentido que vuelva a pedir la
  // cuenta que ya pagó. Una mesa cerrada tampoco llama a nadie.
  const paid = sessionRequestState(session, 'in_person_payment').status === 'attended'
  const done = paid || closed
  const visible = paid
    ? // Pagada, lo único que importa es eso; la cuenta que le acercaron antes es ruido.
      entries.filter((entry) => entry.kind === 'in_person_payment')
    : done
      ? entries.filter((entry) => entry.state.status === 'attended')
      : entries
  if (visible.length === 0) return null

  return (
    <section className="bill-panel" aria-label="Atención en tu mesa">
      <h3>{paid ? '¡Gracias por tu visita!' : closed ? 'Atención en tu mesa' : '¿Terminaron?'}</h3>
      {!done && (
        <p className="muted">
          Avisale al restaurante sin levantar la mano: la mesa queda marcada en el salón.
        </p>
      )}

      <ul className="split-list">
        {visible.map(({ kind, copy, state }) => (
          <li key={kind} className="choice">
            <span>
              {state.status === 'waiting' && `${copy.waiting} · ${formatElapsed(state.since, now)}`}
              {state.status === 'attended' && copy.attended}
              {state.status === 'idle' && copy.action}
              <small className="muted">
                {state.status === 'attended' ? formatElapsed(state.at, now) : copy.help}
              </small>
            </span>
            {state.status === 'waiting' ? (
              <strong className="settled">Avisado</strong>
            ) : (
              !done &&
              offered(kind) && (
                <button disabled={ask.isPending} onClick={() => ask.mutate(kind)}>
                  {ask.isPending && ask.variables === kind
                    ? 'Avisando…'
                    : // Volver a llamar es la excepción —no llegó—, no la acción principal.
                      state.status === 'attended'
                      ? 'Volver a avisar'
                      : copy.action}
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {/* El pago desde el celular (MI-40) cuelga de `mobile`, en la fase 10. */}
      {!done && paymentMethods.includes('external') && (
        <p className="muted">También podés pagar en efectivo o en la caja del local.</p>
      )}

      {ask.isError && (
        <p className="notice" role="alert">
          {ask.error.message}
        </p>
      )}
    </section>
  )
}

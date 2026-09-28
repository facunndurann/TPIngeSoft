import { useMutation } from '@tanstack/react-query'
import {
  formatElapsed,
  type SessionRequestKind,
  sessionRequestLabels,
  sessionRequestsOf,
  type SessionRequestSource,
  sessionRequestState,
} from '@restaurant-platform/shared'
import { BadgeCheck, BellRing, Check } from 'lucide-react'
import { Badge, Button, ErrorText, useSaveErrors } from '@restaurant-platform/ui'
import { useCan } from '@/context/pos-context'
import { resolvePosSessionRequest } from './queries'

/** El color es el mismo que pinta la mesa en el plano para ese estado. */
const requestColors: Record<SessionRequestKind, 'indigo' | 'red'> = {
  bill: 'indigo',
  in_person_payment: 'red',
}

/** Lo que el mozo acaba de hacer, que es lo que cierra la solicitud. */
const attendLabels: Record<SessionRequestKind, string> = {
  bill: 'Cuenta entregada',
  in_person_payment: 'Cobro atendido',
}

/**
 * Lo que la mesa pidió (MI-47), la espera más vieja primero. Devuelve null si no
 * pidió nada, así la tarjeta o el plano no reservan lugar para una lista vacía.
 */
export function SessionRequestBadges({
  session,
  now,
}: {
  session: SessionRequestSource
  now: number
}) {
  const requests = sessionRequestsOf(session)
  if (requests.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Solicitudes de la mesa">
      {requests.map((request) => (
        <li key={request.kind}>
          <Badge color={requestColors[request.kind]}>
            <BellRing size={11} className="mr-1" aria-hidden="true" />
            {sessionRequestLabels[request.kind]} · {formatElapsed(request.requestedAt, now, 'exact')}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/**
 * La mesa ya fue cobrada en persona y sigue abierta: queda cerrarla, que es de
 * caja o supervisión (`sessions.close`), no del mozo que cobró. No es lo mismo
 * que `session_bills.is_settled`: ahí el saldo está pago en el sistema, acá lo
 * que hay es un mozo que dijo que cobró (el registro del pago llega con MI-49).
 */
export function ChargedBadge({
  session,
  now,
}: {
  session: SessionRequestSource
  now: number
}) {
  const charged = sessionRequestState(session, 'in_person_payment')
  if (charged.status !== 'attended') return null

  return (
    <Badge color="green">
      <BadgeCheck size={11} className="mr-1" aria-hidden="true" />
      Cobrada · {formatElapsed(charged.at, now, 'exact')}
    </Badge>
  )
}

/**
 * Un botón por solicitud viva para darla por atendida. Sin el permiso del salón
 * la mesa se sigue viendo marcada, pero no se puede descartar el aviso.
 */
export function AttendRequestButtons({
  sessionId,
  session,
}: {
  sessionId: string
  session: SessionRequestSource
}) {
  const can = useCan()
  const errors = useSaveErrors()

  const attend = useMutation(
    errors.saving('No pudimos marcar la solicitud como atendida.', {
      mutationFn: (kind: SessionRequestKind) => resolvePosSessionRequest(sessionId, kind),
    }),
  )

  const requests = sessionRequestsOf(session)
  if (requests.length === 0 || !can('sessions.attend')) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {requests.map((request) => (
          <Button
            key={request.kind}
            variant="secondary"
            disabled={attend.isPending}
            onClick={() => attend.mutate(request.kind)}
          >
            <Check size={15} aria-hidden="true" />
            {attendLabels[request.kind]}
          </Button>
        ))}
      </div>
      <ErrorText error={errors.message} />
    </div>
  )
}

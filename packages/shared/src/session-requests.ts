/**
 * Lo que una mesa puede pedirle al salón (MI-38/MI-46) y en qué anda cada
 * pedido. Es un concepto de las dos puntas: el comensal pide y ve la respuesta,
 * el salón las atiende. Por eso no vive en el módulo del tablero.
 */
import type { Database } from './database.types.ts'

/** Los define el enum `session_request_kind` de la base, que es lo que aceptan las dos RPCs. */
export type SessionRequestKind = Database['public']['Enums']['session_request_kind']

export const sessionRequestKinds = ['bill', 'in_person_payment'] as const satisfies
  readonly SessionRequestKind[]

/** Cómo lo ve el salón; al comensal se le habla en primera persona, en su app. */
export const sessionRequestLabels: Record<SessionRequestKind, string> = {
  bill: 'Cuenta solicitada',
  in_person_payment: 'Cobro presencial',
}

/** Parte de la sesión que describe sus solicitudes, en cualquiera de las dos apps. */
export type SessionRequestSource = {
  bill_requested_at?: string | null
  bill_attended_at?: string | null
  in_person_payment_requested_at?: string | null
  in_person_payment_attended_at?: string | null
}

/**
 * Las dos fechas de cada tipo de solicitud. Son momentos, no banderas: mientras
 * `requested` tiene fecha la mesa espera, y atenderla la pasa a `attended`, que
 * es lo que le confirma al comensal que ya lo atendieron.
 */
const sessionRequestColumns = {
  bill: { requested: 'bill_requested_at', attended: 'bill_attended_at' },
  in_person_payment: {
    requested: 'in_person_payment_requested_at',
    attended: 'in_person_payment_attended_at',
  },
} as const satisfies Record<
  SessionRequestKind,
  { requested: keyof SessionRequestSource; attended: keyof SessionRequestSource }
>

export type SessionRequest = { kind: SessionRequestKind; requestedAt: string }

/**
 * En qué anda un tipo de solicitud: nadie pidió nada, la mesa espera, o el
 * salón ya la atendió. Los tres estados son excluyentes —pedir de nuevo borra
 * la confirmación anterior—, pero si la base quedara con las dos fechas manda
 * la espera, que es la que necesita acción.
 */
export type SessionRequestState =
  | { status: 'idle' }
  | { status: 'waiting'; since: string }
  | { status: 'attended'; at: string }

export function sessionRequestState(
  session: SessionRequestSource | null | undefined,
  kind: SessionRequestKind,
): SessionRequestState {
  const columns = sessionRequestColumns[kind]
  const since = session?.[columns.requested]
  if (since) return { status: 'waiting', since }
  const at = session?.[columns.attended]
  return at ? { status: 'attended', at } : { status: 'idle' }
}

/**
 * Solicitudes vivas de una sesión, la que espera hace más tiempo primero: es el
 * orden en que el salón las tiene que atender.
 */
export function sessionRequestsOf(
  session: SessionRequestSource | null | undefined,
): SessionRequest[] {
  return sessionRequestKinds
    .flatMap((kind) => {
      const state = sessionRequestState(session, kind)
      return state.status === 'waiting' ? [{ kind, requestedAt: state.since }] : []
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
}

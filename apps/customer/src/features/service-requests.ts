import { useEffect, useRef } from 'react'
import {
  type PaymentMethod,
  type SessionRequestKind,
  sessionRequestKinds,
  type SessionRequestSource,
  sessionRequestState,
} from '@restaurant-platform/shared'

/**
 * Qué medio de pago necesita cada aviso (MI-48). Pedir la cuenta no necesita
 * ninguno: querer ver lo que se debe no es elegir cómo pagarlo.
 */
export const serviceRequestMethod: Record<SessionRequestKind, PaymentMethod | null> = {
  bill: null,
  in_person_payment: 'in_person',
}

/**
 * Al comensal se le habla de lo suyo; el mismo pedido, en el salón, es «Cuenta
 * solicitada». La confirmación es el texto importante: es lo que responde
 * «¿ya está, me puedo ir?».
 */
export const serviceRequestCopy: Record<
  SessionRequestKind,
  { action: string; waiting: string; attended: string; help: string }
> = {
  bill: {
    action: 'Pedir la cuenta',
    waiting: 'Pediste la cuenta',
    attended: '¡Listo! Te acercamos la cuenta.',
    help: 'El restaurante la prepara y te la acerca a la mesa.',
  },
  in_person_payment: {
    action: 'Que venga un mozo a cobrar',
    waiting: 'Pediste cobrar en la mesa',
    attended: '¡Listo! Tu pago fue procesado. Ya podés retirarte.',
    help: 'Un mozo se acerca para cobrarte ahí mismo.',
  },
}

/**
 * Avisa una sola vez, con un toast, cuando el salón atiende lo que la mesa
 * pidió. Se usa arriba de todo y no dentro del panel de la cuenta porque el
 * comensal puede estar en cualquier pantalla cuando lo cobran; el panel se
 * encarga del mensaje que queda después.
 */
export function useAttentionAnnouncements(
  session: SessionRequestSource | undefined,
  announce: (message: string) => void,
) {
  const known = useRef<Record<SessionRequestKind, string | null> | null>(null)

  useEffect(() => {
    if (!session) return
    const current = Object.fromEntries(
      sessionRequestKinds.map((kind) => {
        const state = sessionRequestState(session, kind)
        return [kind, state.status === 'attended' ? state.at : null]
      }),
    ) as Record<SessionRequestKind, string | null>

    const previous = known.current
    known.current = current
    // Primera lectura de la mesa: lo que ya estaba atendido no es una novedad.
    if (!previous) return

    for (const kind of sessionRequestKinds) {
      if (current[kind] && current[kind] !== previous[kind]) {
        announce(serviceRequestCopy[kind].attended)
      }
    }
  }, [session, announce])
}

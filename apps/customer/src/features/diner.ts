import type { Tables } from '@restaurant-platform/shared'

export type Participant = Tables<'session_participants'>

/** Lo que hace falta de la sesión leída para saber quién es quién en la mesa. */
type SessionView = Pick<Tables<'table_sessions'>, 'status'> & { participants: Participant[] }

/**
 * Este comensal en la mesa y cómo se nombra a cada uno. Se calcula una sola vez
 * por lectura de la sesión y lo publica el contexto: antes lo derivaban cuatro
 * componentes por su cuenta, cada uno con su propia comparación.
 */
export function dinerIn(session: SessionView | undefined, userId: string | undefined) {
  const participants = session?.participants ?? []
  // Un invitado no tiene user_id: sin id propio todavía, no hay con quién confundirse.
  const me = userId ? participants.find((entry) => entry.user_id === userId) : undefined
  const named = !!me?.named_at

  return {
    /** La fila de este comensal; `undefined` hasta que la sesión lo incluye. */
    me,
    /** Si eligió su nombre, o sigue con el que puso el sistema. Se le pide recién al agregar algo. */
    named,
    closed: session?.status === 'closed',
    /**
     * Cómo se nombra a un comensal en las listas de la mesa: por su nombre, con
     * «(vos)» si es este, y «Comensal» si ya no figura en la mesa.
     */
    nameOf: (id: string | null) => {
      const participant = participants.find((entry) => entry.id === id)
      if (!participant) return 'Comensal'
      return participant.id === me?.id ? `${participant.display_name} (vos)` : participant.display_name
    },
  }
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppError, participantNameSchema } from '@restaurant-platform/shared'
import { errorMessage } from '@restaurant-platform/ui'
import { loadMenu, loadTable } from '@/features/menu-api'
import { connectSession, joinSession, loadSession } from '@/features/session'
import { subscribeToTableSession } from '@/features/session-realtime'

/**
 * El campo del nombre, listo para dibujar: quien lo muestra no necesita saber
 * que del otro lado hay una mutación.
 */
export type RenameField = {
  /** Lo que muestra el campo: el borrador mientras se edita, si no lo guardado. */
  name: string
  setName: (name: string) => void
  /** Si el formulario está abierto. Solo decide algo cuando ya hay nombre elegido:
   *  sin nombre se muestra igual, porque la mesa lo necesita antes del primer pedido. */
  editing: boolean
  setEditing: (editing: boolean) => void
  submit: () => void
  isPending: boolean
  /** El último intento fallido, ya en palabras. */
  message?: string
}

/** El fallo de guardar en palabras; lo que no es Error no tiene nada que decirle al comensal. */
function renameMessage(error: unknown): string {
  return errorMessage(error, 'No pudimos guardar tu nombre. Intentá nuevamente.')
}

export function useTableSession(token: string) {
  const client = useQueryClient()

  const table = useQuery({
    queryKey: ['table', token],
    queryFn: () => loadTable(token),
  })

  const menu = useQuery({
    queryKey: ['menu', table.data?.restaurant.id],
    queryFn: () => loadMenu(table.data!.restaurant.id),
    enabled: !!table.data,
    refetchInterval: 60000,
  })

  const joined = useQuery({
    queryKey: ['join', token],
    queryFn: () => connectSession(token, table.data!.table.id),
    enabled: !!table.data,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

  const sessionId = joined.data?.id

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => loadSession(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })

  useEffect(() => {
    if (!sessionId) return

    const refresh = () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] })
      void client.invalidateQueries({ queryKey: ['orders', sessionId] })
      void client.invalidateQueries({ queryKey: ['bill', sessionId] })
      void client.invalidateQueries({ queryKey: ['payments', sessionId] })
    }

    return subscribeToTableSession(sessionId, refresh)
  }, [sessionId, client])

  const participant = session.data?.participants.find(
    (entry) => entry.user_id === joined.data?.userId,
  )
  // Solo se precarga un nombre elegido: precargar el que puso el sistema
  // invitaría a guardarlo como propio.
  const savedName = participant?.named_at ? participant.display_name : ''

  // `undefined` = el campo muestra lo guardado. Mientras se edita manda el
  // borrador, así el refetch cada 15 segundos no pisa lo que se está tipeando.
  const [draftName, setDraftName] = useState<string>()
  // El formulario abierto es de quien guarda el nombre, no del panel: así se
  // cierra cuando el guardado terminó y no cuando cambia un flag de la mutación.
  const [editingName, setEditingName] = useState(false)

  const rename = useMutation({
    mutationFn: async () => {
      // El mismo límite que revalida customer_join_table_session, con su mensaje.
      const validName = participantNameSchema.safeParse(draftName ?? savedName)
      if (!validName.success) throw new AppError('INVALID_NAME')
      const result = await joinSession(token, validName.data)
      client.setQueryData(['join', token], result)
      await client.invalidateQueries({ queryKey: ['session', result.id] })
    },
    // Guardado el nombre, el campo vuelve a mostrar lo que hay en la mesa y el
    // formulario se cierra: ya cumplió y deja de ocupar la pantalla en cada pedido.
    onSuccess: () => {
      setDraftName(undefined)
      setEditingName(false)
    },
  })

  return {
    client,
    table,
    menu,
    joined,
    session,
    sessionId,
    /** Cómo se llama este comensal en la mesa; sin nombre elegido, el genérico. */
    displayName: participant?.display_name ?? 'Comensal',
    /** Si eligió su nombre. Único origen del invariante: lo leen la compuerta del
     *  carrito y el panel, que ya no lo vuelve a derivar de los participantes. */
    named: !!participant?.named_at,
    rename: {
      name: draftName ?? savedName,
      setName: setDraftName,
      editing: editingName,
      setEditing: setEditingName,
      submit: () => rename.mutate(),
      isPending: rename.isPending,
      message: rename.isError ? renameMessage(rename.error) : undefined,
    } satisfies RenameField,
  }
}

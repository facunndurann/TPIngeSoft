import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppError, participantNameSchema } from '@restaurant-platform/shared'
import { errorMessage } from '@restaurant-platform/ui'
import { dinerIn } from '@/features/diner'
import { loadMenu, loadTable } from '@/features/menu-api'
import { connectSession, joinSession, sessionKey, sessionQuery } from '@/features/session'
import { subscribeToTableSession } from '@/features/session-realtime'

/**
 * El campo del nombre, listo para dibujar: quien lo muestra no necesita saber
 * que del otro lado hay una mutación.
 */
export type RenameField = {
  /** Lo que muestra el campo: el borrador mientras se edita, si no lo guardado. */
  name: string
  setName: (name: string) => void
  /** Si el comensal está editando el nombre en el chip. La primera vez el
   *  diálogo se muestra solo por `needsName`, no por este flag. */
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

  const session = useQuery(sessionQuery(sessionId))

  // Toda la mesa de una vez: sesión, pedidos, cuenta y pagos cuelgan de la misma
  // raíz. Se resuelve cuando terminaron de releerse, así quien espera ya ve lo nuevo.
  const refreshTable = useCallback(async () => {
    if (sessionId) await client.invalidateQueries({ queryKey: sessionKey(sessionId) })
  }, [client, sessionId])

  useEffect(() => {
    if (!sessionId) return
    return subscribeToTableSession(sessionId, () => {
      void refreshTable()
    })
  }, [sessionId, refreshTable])

  const diner = dinerIn(session.data, joined.data?.userId)
  // Solo se precarga un nombre elegido: precargar el que puso el sistema
  // invitaría a guardarlo como propio.
  const savedName = diner.named ? diner.me?.display_name ?? '' : ''

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
      // Por el id devuelto y no por `sessionId`: el render que lo actualiza todavía no pasó.
      await client.invalidateQueries({ queryKey: sessionKey(result.id) })
    },
    // Guardado el nombre, el campo vuelve a mostrar lo que hay en la mesa y el
    // formulario se cierra: ya cumplió y deja de ocupar la pantalla en cada pedido.
    onSuccess: () => {
      setDraftName(undefined)
      setEditingName(false)
    },
  })

  return {
    table,
    menu,
    joined,
    session,
    sessionId,
    /** Relee todo lo de la mesa; lo que cambió algo lo llama en vez de elegir consultas. */
    refreshTable,
    /** Se puede pedir: la mesa está abierta y su última lectura no falló. */
    sessionOpen: session.data?.status === 'open' && !session.isError,
    ...diner,
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

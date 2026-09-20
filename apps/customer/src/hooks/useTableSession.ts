import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppError, participantNameSchema } from '@restaurant-platform/shared'
import { loadMenu, loadTable } from '@/features/menu-api'
import { connectSession, joinSession, loadSession } from '@/features/session'
import { subscribeToTableSession } from '@/features/session-realtime'

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
    }

    return subscribeToTableSession(sessionId, refresh)
  }, [sessionId, client])

  const [name, setName] = useState('')

  const rename = useMutation({
    mutationFn: async () => {
      // El mismo límite que revalida customer_join_table_session, con su mensaje.
      const validName = participantNameSchema.safeParse(name)
      if (!validName.success) throw new AppError('INVALID_NAME')
      const result = await joinSession(token, validName.data)
      client.setQueryData(['join', token], result)
      await client.invalidateQueries({ queryKey: ['session', result.id] })
    },
  })

  return { client, table, menu, joined, session, sessionId, name, setName, rename }
}

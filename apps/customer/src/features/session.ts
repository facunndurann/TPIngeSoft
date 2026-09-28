import { queryOptions, skipToken } from '@tanstack/react-query'
import { AppError, unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { useCart } from '@/stores/cart'
import { recoverPendingSession } from '@/features/session-recovery'

/** Respaldo de Realtime: cada lectura de la mesa se repite sola cada 15 segundos. */
export const SESSION_POLL_MS = 15000

/**
 * Raíz de todo lo que se lee de una mesa. La sesión cuelga de acá y sus pedidos,
 * cuenta y pagos debajo, así que invalidar esta key los refresca juntos: react-query
 * compara por prefijo. Nadie tiene que acordarse de qué consultas toca su cambio.
 */
export function sessionKey(sessionId: string | undefined) {
  return ['session', sessionId] as const
}

export function sessionQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: sessionKey(sessionId),
    // Sin sesión todavía no hay nada que leer: `skipToken` la deja en espera.
    queryFn: sessionId ? () => loadSession(sessionId) : skipToken,
    refetchInterval: SESSION_POLL_MS,
  })
}

let signingIn: Promise<string> | undefined

const CONNECT_FAILED = 'No pudimos conectarte con la mesa. Revisá tu conexión y reintentá.'

async function authenticate() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new AppError('CONNECTION_ERROR', CONNECT_FAILED, error.message)
  if (data.session) return data.session.user.id

  const result = await supabase.auth.signInAnonymously()
  if (result.error) throw new AppError('CONNECTION_ERROR', CONNECT_FAILED, result.error.message)
  return result.data.user!.id
}

async function authenticatedUserId() {
  signingIn ??= authenticate().finally(() => {
    signingIn = undefined
  })
  return signingIn
}

export async function connectSession(token: string, tableId: string) {
  const userId = await authenticatedUserId()
  const id = await recoverPendingSession(userId, tableId, useCart.getState().submissions, async (ids) =>
    unwrap(
      await supabase
        .from('table_sessions')
        .select('id, table_id, session_participants!inner(user_id)')
        .in('id', ids)
        .eq('table_id', tableId)
        .eq('session_participants.user_id', userId)
        .order('opened_at', { ascending: false }),
    ),
  )

  if (id) return { id, userId }
  return joinSession(token)
}

export async function joinSession(token: string, name?: string) {
  const userId = await authenticatedUserId()
  const id = unwrap(
    await supabase.rpc('join_table_session', {
      qr: token,
      ...(name ? { participant_name: name } : {}),
    }),
  )
  return { id, userId }
}

export async function loadSession(id: string) {
  const [session, participants] = await Promise.all([
    supabase.from('table_sessions').select('*').eq('id', id).single(),
    supabase.from('session_participants').select('*').eq('session_id', id).order('joined_at'),
  ])
  return { ...unwrap(session), participants: unwrap(participants) }
}

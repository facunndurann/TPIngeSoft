import { AppError, fromPostgres } from '@restaurant-platform/shared'
import { fromRead } from '@/features/api-errors'
import { supabase } from '@/lib/supabase'
import { useCart } from '@/stores/cart'
import { recoverPendingSession } from '@/features/session-recovery'

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
  const id = await recoverPendingSession(userId, tableId, useCart.getState().submissions, async (ids) => {
    const { data, error } = await supabase
      .from('table_sessions')
      .select('id, table_id, session_participants!inner(user_id)')
      .in('id', ids)
      .eq('table_id', tableId)
      .eq('session_participants.user_id', userId)
      .order('opened_at', { ascending: false })
    if (error) throw fromRead(error, 'tu mesa')
    return data
  })

  if (id) return { id, userId }
  return joinSession(token)
}

export async function joinSession(token: string, name?: string) {
  const userId = await authenticatedUserId()
  const { data: id, error } = await supabase.rpc('join_table_session', {
    qr: token,
    ...(name ? { participant_name: name } : {}),
  })
  if (error) throw fromPostgres(error)
  return { id, userId }
}

export async function loadSession(id: string) {
  const [session, participants] = await Promise.all([
    supabase.from('table_sessions').select('*').eq('id', id).single(),
    supabase.from('session_participants').select('*').eq('session_id', id).order('joined_at'),
  ])
  if (session.error) throw fromRead(session.error, 'tu mesa')
  if (participants.error) throw fromRead(participants.error, 'los comensales de la mesa')
  return { ...session.data, participants: participants.data }
}

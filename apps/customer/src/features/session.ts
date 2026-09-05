import { supabase } from '../lib/supabase'
import { useCart } from '../stores/cart'
import { recoverPendingSession } from './session-recovery'
let signingIn: Promise<string> | undefined
async function authenticate() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session) return data.session.user.id
  const result = await supabase.auth.signInAnonymously()
  if (result.error) throw result.error
  return result.data.user!.id
}
async function authenticatedUserId() {
  signingIn ??= authenticate().finally(() => { signingIn = undefined })
  return signingIn
}
export async function connectSession(token: string, tableId: string) {
  const userId = await authenticatedUserId()
  const id = await recoverPendingSession(userId, tableId, useCart.getState().submissions, async ids => {
    const { data, error } = await supabase.from('table_sessions')
      .select('id, table_id, session_participants!inner(user_id)')
      .in('id', ids).eq('table_id', tableId).eq('session_participants.user_id', userId)
      .order('opened_at', { ascending: false })
    if (error) throw error
    return data
  })
  if (id) return { id, userId }
  return joinSession(token)
}
export async function joinSession(token: string, name?: string) {
  const userId = await authenticatedUserId()
  const { data: id, error } = await supabase.rpc('join_table_session', { qr: token, ...(name ? { participant_name: name } : {}) })
  if (error) throw error
  return { id, userId }
}
export async function loadSession(id: string) {
  const [session, participants] = await Promise.all([
    supabase.from('table_sessions').select('*').eq('id', id).single(),
    supabase.from('session_participants').select('*').eq('session_id', id).order('joined_at'),
  ])
  if (session.error) throw session.error
  if (participants.error) throw participants.error
  return { ...session.data, participants: participants.data }
}

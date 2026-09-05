import { supabase } from '../lib/supabase'
let signingIn: Promise<string> | undefined
async function authenticate() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session) return data.session.user.id
  const result = await supabase.auth.signInAnonymously()
  if (result.error) throw result.error
  return result.data.user!.id
}
export async function joinSession(token: string, name?: string) {
  signingIn ??= authenticate().finally(() => { signingIn = undefined })
  const userId = await signingIn
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

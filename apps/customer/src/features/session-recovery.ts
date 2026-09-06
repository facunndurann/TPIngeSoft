import type { PendingSubmission } from '../stores/cart'

type RecoverableSession = {
  id: string
  table_id: string
  session_participants: { user_id: string }[]
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Local drafts provide candidates; the database must prove table and membership. */
export async function recoverPendingSession(
  userId: string,
  tableId: string,
  submissions: Record<string, PendingSubmission | undefined>,
  lookup: (ids: string[]) => Promise<RecoverableSession[]>,
) {
  const ids = Object.entries(submissions).flatMap(([key, submission]) => {
    const id = submission?.input.sessionId
    const matchesKey = id && key === `${id}:${userId}` && SESSION_ID.test(id)
    return matchesKey ? [id] : []
  })
  if (!ids.length) return undefined

  // A connection failure must abort: opening a new session could hide an unresolved order.
  const sessions = await lookup(ids)
  return sessions.find(
    (session) =>
      ids.includes(session.id) &&
      session.table_id === tableId &&
      session.session_participants.some((participant) => participant.user_id === userId),
  )?.id
}

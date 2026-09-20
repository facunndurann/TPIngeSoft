import type { UseQueryResult } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { ErrorMessage } from '@/components/ErrorMessage'
import type { loadSession } from '@/features/session'

type Session = Awaited<ReturnType<typeof loadSession>>
type JoinResult = { id: string; userId: string }

type SessionPanelProps = {
  joined: UseQueryResult<JoinResult>
  session: UseQueryResult<Session>
  userId?: string
  hasPendingSubmission: boolean
  name: string
  onNameChange: (value: string) => void
  rename: { mutate: () => void; isPending: boolean; isError: boolean; error: unknown }
  onOpenNewSession: () => void
}

export function SessionPanel({
  joined,
  session,
  userId,
  hasPendingSubmission,
  name,
  onNameChange,
  rename,
  onOpenNewSession,
}: SessionPanelProps) {
  const currentParticipant = session.data?.participants.find((p) => p.user_id === userId)
  const displayName = currentParticipant?.display_name ?? 'Comensal'
  const names = session.data?.participants.map((p) => p.display_name).join(' · ') ?? ''

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    rename.mutate()
  }

  return (
    <section className="session-panel" aria-label="Tu mesa">
      {joined.isPending && <p role="status">Conectando con tu mesa…</p>}
      {joined.isError && (
        <ErrorMessage error={joined.error} retry={() => { void joined.refetch() }} />
      )}
      {session.isError && (
        <ErrorMessage error={session.error} retry={() => { void session.refetch() }} />
      )}

      {session.data && (
        <>
          <p>
            <strong>{displayName}</strong> · {session.data.participants.length} en la mesa
          </p>
          <p className="muted">{names}</p>

          {session.data.status === 'closed' ? (
            <ClosedSessionNotice
              hasPendingSubmission={hasPendingSubmission}
              onOpenNewSession={onOpenNewSession}
            />
          ) : (
            <form className="name-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="name">
                Tu nombre
              </label>
              <input
                id="name"
                placeholder="Tu nombre para la mesa"
                value={name}
                maxLength={40}
                required
                onChange={(event) => onNameChange(event.target.value)}
              />
              <button disabled={rename.isPending || !name.trim() || hasPendingSubmission}>
                Guardar nombre
              </button>
              {rename.isError && (
                <p role="alert">
                  {rename.error instanceof Error
                    ? rename.error.message
                    : 'No pudimos guardar tu nombre. Intentá nuevamente.'}
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  )
}

function ClosedSessionNotice({
  hasPendingSubmission,
  onOpenNewSession,
}: {
  hasPendingSubmission: boolean
  onOpenNewSession: () => void
}) {
  const message = hasPendingSubmission
    ? 'Revisá el envío pendiente antes de empezar de nuevo.'
    : 'Los productos del carrito no se enviarán.'

  return (
    <div className="notice">
      <p>La mesa cerró su cuenta. Podés seguir consultando sus pedidos. {message}</p>
      <button disabled={hasPendingSubmission} onClick={onOpenNewSession}>
        Empezar de nuevo en esta mesa
      </button>
    </div>
  )
}

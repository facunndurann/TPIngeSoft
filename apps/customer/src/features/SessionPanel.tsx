import type { UseQueryResult } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ErrorMessage } from '@/components/ErrorMessage'
import type { loadSession } from '@/features/session'

type Session = Awaited<ReturnType<typeof loadSession>>
type JoinResult = { id: string; userId: string }

type SessionPanelProps = {
  joined: UseQueryResult<JoinResult>
  session: UseQueryResult<Session>
  userId?: string
  hasPendingSubmission: boolean
  cartCount: number
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
  cartCount,
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
              cartCount={cartCount}
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
  cartCount,
  onOpenNewSession,
}: {
  hasPendingSubmission: boolean
  cartCount: number
  onOpenNewSession: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const plates = `${cartCount} ${cartCount === 1 ? 'plato' : 'platos'}`

  const message = hasPendingSubmission
    ? 'Revisá el envío pendiente antes de empezar de nuevo.'
    : cartCount > 0
      ? `Tenés ${plates} sin enviar en el carrito.`
      : ''

  // Empezar de nuevo descarta el carrito y eso no se puede deshacer, así que se
  // pregunta antes. Con el carrito vacío no hay nada que perder ni que preguntar.
  if (confirming) {
    return (
      <div className="notice">
        <p>
          Si empezás de nuevo, se descartan los {plates} que todavía no enviaste. No vas a poder
          recuperarlos.
        </p>
        <div className="cart-actions">
          <button onClick={() => setConfirming(false)}>Seguir en esta cuenta</button>
          <button className="primary" onClick={onOpenNewSession}>
            Descartar y empezar de nuevo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="notice">
      <p>La mesa cerró su cuenta. Podés seguir consultando sus pedidos. {message}</p>
      <button
        disabled={hasPendingSubmission}
        onClick={() => (cartCount > 0 ? setConfirming(true) : onOpenNewSession())}
      >
        Empezar de nuevo en esta mesa
      </button>
    </div>
  )
}

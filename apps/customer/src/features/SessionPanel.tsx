import type { UseQueryResult } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { ErrorMessage } from '@/components/ErrorMessage'
import { NAME_FIELD_ID } from '@/features/name-field'
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
  rename: {
    mutate: () => void
    isPending: boolean
    isSuccess: boolean
    isError: boolean
    error: unknown
  }
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
  const named = !!currentParticipant?.named_at
  const names = session.data?.participants.map((p) => p.display_name).join(' · ') ?? ''
  const [editing, setEditing] = useState(false)

  // Guardado el nombre, el formulario se cierra: ya cumplió y deja de ocupar la
  // pantalla en cada pedido. Al reabrirlo, `isSuccess` no cambió, así que queda abierto.
  useEffect(() => {
    if (rename.isSuccess) setEditing(false)
  }, [rename.isSuccess])

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
          ) : named && !editing ? (
            <button className="text-button" onClick={() => setEditing(true)}>
              Cambiar mi nombre
            </button>
          ) : (
            <>
              {/* Se pide antes del primer pedido, con el motivo: un comensal sin
                  nombre no se puede distinguir en la cuenta de la mesa. */}
              {!named && (
                <p>Poné tu nombre así la mesa sabe qué pidió cada uno al dividir la cuenta.</p>
              )}
              <form className="name-form" onSubmit={handleSubmit}>
                <label className="sr-only" htmlFor={NAME_FIELD_ID}>
                  Tu nombre
                </label>
                <input
                  id={NAME_FIELD_ID}
                  placeholder="Tu nombre para la mesa"
                  value={name}
                  maxLength={40}
                  required
                  autoComplete="given-name"
                  onChange={(event) => onNameChange(event.target.value)}
                />
                <button disabled={rename.isPending || !name.trim() || hasPendingSubmission}>
                  {rename.isPending ? 'Guardando…' : 'Guardar nombre'}
                </button>
                {named && (
                  <button type="button" disabled={rename.isPending} onClick={() => setEditing(false)}>
                    Cancelar
                  </button>
                )}
                {rename.isError && (
                  <p role="alert">
                    {rename.error instanceof Error
                      ? rename.error.message
                      : 'No pudimos guardar tu nombre. Intentá nuevamente.'}
                  </p>
                )}
              </form>
            </>
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

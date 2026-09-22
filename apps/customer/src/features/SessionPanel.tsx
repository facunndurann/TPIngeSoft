import { type FormEvent, useState } from 'react'
import { ErrorText } from '@restaurant-platform/ui'
import { NameModal } from '@/features/NameModal'
import { NAME_FIELD_ID } from '@/features/name-field'
import type { loadSession } from '@/features/session'
import type { RenameField } from '@/hooks/useTableSession'

type Session = Awaited<ReturnType<typeof loadSession>>

/** Una falla a mostrar, con su reintento ya resuelto por quien hizo la consulta. */
export type Failure = { error: unknown; retry: () => void }

type SessionPanelProps = {
  /** Todavía conectando con la mesa. */
  connecting: boolean
  /** No se pudo entrar a la mesa. */
  connection?: Failure
  /** No se pudo leer la mesa. */
  read?: Failure
  /** La mesa leída; hasta que llegue, el panel solo informa el estado. */
  session?: Session
  /** Cómo se llama este comensal y si el nombre lo eligió él: los decide el hook
      dueño de la sesión, así que acá no se vuelven a derivar. */
  displayName: string
  named: boolean
  hasPendingSubmission: boolean
  cartCount: number
  rename: RenameField
  onOpenNewSession: () => void
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function SessionPanel({
  connecting,
  connection,
  read,
  session,
  displayName,
  named,
  hasPendingSubmission,
  cartCount,
  rename,
  onOpenNewSession,
}: SessionPanelProps) {
  const names = session?.participants.map((p) => p.display_name).join(' · ') ?? ''
  const askName = !!session && session.status !== 'closed' && !named
  const showPanel = connecting || !!connection || !!read || (!!session && named) || session?.status === 'closed'
  const canRename = named && session?.status !== 'closed'

  function handleRename(event: FormEvent) {
    event.preventDefault()
    rename.submit()
  }

  return (
    <>
      {showPanel && (
        <section className="session-panel" aria-label="Tu mesa">
          {connecting && <p role="status">Conectando con tu mesa…</p>}
          {connection && <ErrorText {...connection} variant="menu" />}
          {read && <ErrorText {...read} variant="menu" />}

          {session && named && (
            <div className="table-people">
              {rename.editing ? (
                <form
                  className="name-inline"
                  onSubmit={handleRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      rename.setEditing(false)
                    }
                  }}
                >
                  <label className="sr-only" htmlFor={NAME_FIELD_ID}>
                    Tu nombre
                  </label>
                  <input
                    id={NAME_FIELD_ID}
                    value={rename.name}
                    maxLength={40}
                    required
                    autoFocus
                    autoComplete="given-name"
                    onChange={(event) => rename.setName(event.target.value)}
                  />
                  <button
                    className="icon-button"
                    aria-label="Guardar nombre"
                    disabled={rename.isPending || !rename.name.trim() || hasPendingSubmission}
                  >
                    <CheckIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Cancelar"
                    disabled={rename.isPending}
                    onClick={() => rename.setEditing(false)}
                  >
                    <CloseIcon />
                  </button>
                  {rename.message && <p role="alert">{rename.message}</p>}
                </form>
              ) : (
                <>
                  <span className="who">
                    <strong>{displayName}</strong>
                    {canRename && (
                      <button
                        type="button"
                        className="icon-button edit-name"
                        aria-label="Editar nombre"
                        onClick={() => rename.setEditing(true)}
                      >
                        <PencilIcon />
                      </button>
                    )}
                  </span>
                  <details>
                    <summary className="disclosure">
                      <span className="muted">{session.participants.length} en la mesa</span>
                      <span className="chevron" aria-hidden="true">›</span>
                    </summary>
                    <p className="muted">{names}</p>
                  </details>
                </>
              )}
            </div>
          )}

          {session?.status === 'closed' && (
            <ClosedSessionNotice
              hasPendingSubmission={hasPendingSubmission}
              cartCount={cartCount}
              onOpenNewSession={onOpenNewSession}
            />
          )}
        </section>
      )}

      {askName && (
        <NameModal rename={rename} hasPendingSubmission={hasPendingSubmission} />
      )}
    </>
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

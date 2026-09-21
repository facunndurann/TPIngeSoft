import { type FormEvent, useState } from 'react'
import { ErrorText } from '@restaurant-platform/ui'
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    rename.submit()
  }

  return (
    <section className="session-panel" aria-label="Tu mesa">
      {connecting && <p role="status">Conectando con tu mesa…</p>}
      {connection && <ErrorText {...connection} variant="menu" />}
      {read && <ErrorText {...read} variant="menu" />}

      {session && (
        <>
          {/* En reposo el panel es una línea: quién sos y cuántos son. Los nombres
              de la mesa quedan a un toque, sin ocupar el pliegue de la carta. */}
          <div className="table-people">
            <details>
              <summary className="disclosure">
                <span>
                  <strong>{displayName}</strong> · {session.participants.length} en la mesa
                </span>
                <span className="chevron" aria-hidden="true">›</span>
              </summary>
              <p className="muted">{names}</p>
            </details>
            {named && !rename.editing && session.status !== 'closed' && (
              <button className="text-button" onClick={() => rename.setEditing(true)}>
                Cambiar mi nombre
              </button>
            )}
          </div>

          {session.status === 'closed' ? (
            <ClosedSessionNotice
              hasPendingSubmission={hasPendingSubmission}
              cartCount={cartCount}
              onOpenNewSession={onOpenNewSession}
            />
          ) : named && !rename.editing ? null : (
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
                  value={rename.name}
                  maxLength={40}
                  required
                  autoComplete="given-name"
                  onChange={(event) => rename.setName(event.target.value)}
                />
                <button disabled={rename.isPending || !rename.name.trim() || hasPendingSubmission}>
                  {rename.isPending ? 'Guardando…' : 'Guardar nombre'}
                </button>
                {named && (
                  <button
                    type="button"
                    disabled={rename.isPending}
                    onClick={() => rename.setEditing(false)}
                  >
                    Cancelar
                  </button>
                )}
                {rename.message && <p role="alert">{rename.message}</p>}
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

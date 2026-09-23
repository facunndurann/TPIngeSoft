import { type FormEvent, useEffect, useState } from 'react'
import { NameInput } from '@/features/NameInput'
import type { RenameField } from '@/hooks/useTableSession'

type NameModalProps = {
  rename: RenameField
  /** Lo decide la mesa: nombre válido, nada guardándose y ningún envío sin resolver. */
  canSave: boolean
  /** El nombre quedó guardado: sigue lo que el comensal estaba haciendo. */
  onSaved: () => void
  /** Cerrar sin nombre: lo que estaba haciendo se descarta y la carta sigue ahí. */
  onCancel: () => void
}

/**
 * El nombre, pedido en el momento en que hace falta: se abre desde lo que el
 * comensal quiso hacer y, al guardar, eso se hace solo. No es un peaje: se puede
 * cerrar, y el foco vuelve al botón que lo abrió.
 */
export function NameModal({ rename, canSave, onSaved, onCancel }: NameModalProps) {
  // Quién abrió el diálogo, leído en el render: todavía antes de que el campo tome el foco.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      // Si al guardar la pantalla cambió, el botón ya no está y no hay adónde volver.
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])

  const cancel = () => {
    if (!rename.isPending) onCancel()
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    rename.submit(onSaved)
  }

  return (
    <div
      className="name-modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel()
      }}
      onClick={(event) => {
        // Solo el fondo cierra: un toque dentro del diálogo no es para irse.
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div
        className="name-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-modal-title"
      >
        <h2 id="name-modal-title">¿Cómo te llamás?</h2>
        <p className="muted">Así sabemos qué pidió cada uno.</p>
        <form className="name-form" onSubmit={handleSubmit}>
          <NameInput rename={rename} />
          <button className="primary" disabled={!canSave}>
            {rename.isPending ? 'Guardando…' : 'Continuar'}
          </button>
          <button type="button" disabled={rename.isPending} onClick={cancel}>
            Ahora no
          </button>
          {rename.message && <p className="field-error" role="alert">{rename.message}</p>}
        </form>
      </div>
    </div>
  )
}

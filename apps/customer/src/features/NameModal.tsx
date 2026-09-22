import { type FormEvent, useEffect } from 'react'
import { NameInput } from '@/features/NameInput'
import type { RenameField } from '@/hooks/useTableSession'

type NameModalProps = {
  rename: RenameField
  /** Lo decide el panel: nombre válido, nada guardándose y ningún envío sin resolver. */
  canSave: boolean
}

export function NameModal({ rename, canSave }: NameModalProps) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') event.preventDefault()
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    rename.submit()
  }

  return (
    <div className="name-modal-backdrop">
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
          {rename.message && <p role="alert">{rename.message}</p>}
        </form>
      </div>
    </div>
  )
}

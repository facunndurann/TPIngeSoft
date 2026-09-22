import { type FormEvent, useEffect } from 'react'
import { NAME_FIELD_ID } from '@/features/name-field'
import type { RenameField } from '@/hooks/useTableSession'

type NameModalProps = {
  rename: RenameField
  hasPendingSubmission: boolean
}

export function NameModal({ rename, hasPendingSubmission }: NameModalProps) {
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
          <label className="sr-only" htmlFor={NAME_FIELD_ID}>
            Tu nombre
          </label>
          <input
            id={NAME_FIELD_ID}
            placeholder="Tu nombre"
            value={rename.name}
            maxLength={40}
            required
            autoFocus
            autoComplete="given-name"
            onChange={(event) => rename.setName(event.target.value)}
          />
          <button
            className="primary"
            disabled={rename.isPending || !rename.name.trim() || hasPendingSubmission}
          >
            {rename.isPending ? 'Guardando…' : 'Continuar'}
          </button>
          {rename.message && <p role="alert">{rename.message}</p>}
        </form>
      </div>
    </div>
  )
}

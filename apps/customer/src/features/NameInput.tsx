import { useId } from 'react'
import { PARTICIPANT_NAME_MAX_LENGTH } from '@restaurant-platform/shared'
import type { RenameField } from '@/hooks/useTableSession'

/**
 * El campo del nombre del comensal, el mismo en el diálogo de ingreso y en el chip
 * de la mesa: su tope es el de `participantNameSchema` y su id es propio, así que
 * dos formularios nunca comparten una etiqueta.
 */
export function NameInput({ rename }: { rename: RenameField }) {
  const id = useId()
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Tu nombre
      </label>
      <input
        id={id}
        placeholder="Tu nombre"
        value={rename.name}
        maxLength={PARTICIPANT_NAME_MAX_LENGTH}
        required
        autoFocus
        autoComplete="given-name"
        onChange={(event) => rename.setName(event.target.value)}
      />
    </>
  )
}

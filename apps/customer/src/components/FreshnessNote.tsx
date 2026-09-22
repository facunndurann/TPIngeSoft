import { formatElapsed } from '@restaurant-platform/shared'
import { useNow } from '@restaurant-platform/ui'

type FreshnessNoteProps = {
  /** Qué se está actualizando, en palabras del comensal: "la carta". */
  label: string
  /** `dataUpdatedAt` de la consulta; sin lectura previa el aviso no se muestra. */
  updatedAt?: number
  isFetching: boolean
}

/**
 * Deja ver que un panel se refresca solo: cuándo fue la última lectura y cuándo
 * hay una en curso. La primera carga no le corresponde (de eso avisa el
 * "Cargando…" de cada panel), así que sin `updatedAt` no dibuja nada.
 */
export function FreshnessNote({ label, updatedAt, isFetching }: FreshnessNoteProps) {
  const now = useNow()
  if (updatedAt === undefined) return null

  return (
    <div className="freshness">
      {/* `status` anuncia el cambio a un lector de pantalla sin robar el foco. */}
      <p role="status">
        {isFetching ? `Actualizando ${label}…` : `Actualizado ${formatElapsed(updatedAt, now)}`}
      </p>
    </div>
  )
}

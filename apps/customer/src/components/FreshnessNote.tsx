import { formatElapsed } from '@restaurant-platform/shared'
import { useNow } from '@restaurant-platform/ui'

type FreshnessNoteProps = {
  /** Qué se está actualizando, en palabras del comensal: "los pedidos". */
  label: string
  /** `dataUpdatedAt` de la consulta; sin lectura previa el aviso no se muestra. */
  updatedAt?: number
  isFetching: boolean
}

/**
 * Deja ver que un panel se refresca solo: cuándo fue la última lectura y cuándo
 * hay una en curso. La primera carga no le corresponde (de eso avisa el
 * "Cargando…" de cada panel), así que sin `updatedAt` no dibuja nada.
 *
 * Es texto para leer cuando se lo busca, no una región viva: el panel se relee cada
 * pocos segundos, y anunciar cada lectura interrumpiría al lector de pantalla con
 * algo que no pidió. Lo que sí cambia para el comensal (un pedido listo, un cobro)
 * llega por los avisos de la mesa.
 */
export function FreshnessNote({ label, updatedAt, isFetching }: FreshnessNoteProps) {
  const now = useNow()
  if (updatedAt === undefined) return null

  return (
    <div className="freshness">
      <p>
        {isFetching ? `Actualizando ${label}…` : `Actualizado ${formatElapsed(updatedAt, now)}`}
      </p>
    </div>
  )
}

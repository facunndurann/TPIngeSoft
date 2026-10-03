import { CHAIR_SIZE, chairsAround } from './chairs'
import type { FloorTile } from './floorTile'

/** El color de las sillas de una mesa sin nada especial, y del punto que las explica en la leyenda. */
export const CHAIR_COLOR = 'bg-neutral-400'

/**
 * Las sillas de una mesa, una por lugar, alrededor de su caja. Son dibujo: los
 * lugares van en el nombre de la mesa, que es lo que lee un lector de pantalla.
 */
export function TableChairs({
  tile,
  round,
  seats,
  color = CHAIR_COLOR,
  zIndex = 0,
}: {
  tile: FloorTile
  round: boolean
  seats: number
  /** Cambia con lo que pasa con la mesa: elegida, fuera de uso, en un lugar donde no entra. */
  color?: string
  zIndex?: number
}) {
  return (
    <>
      {chairsAround(tile.box, round, seats).map((chair, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`absolute rounded-full ${color}`}
          style={{ ...chair, width: CHAIR_SIZE, height: CHAIR_SIZE, zIndex }}
        />
      ))}
    </>
  )
}

/** «Cada silla es un lugar»: lo que explica las sillas en la leyenda de un plano. */
export function ChairsLegendItem() {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={`h-3 w-3 rounded-full ${CHAIR_COLOR}`} />
      Cada silla es un lugar
    </li>
  )
}

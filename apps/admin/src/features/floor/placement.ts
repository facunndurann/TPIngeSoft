import { collidesWithAny, occupiedBy, tablePlacement, type GridTable } from '@restaurant-platform/shared'

/** Lo que se le dice a quien intenta dejar una mesa encima de otra, de cualquier forma. */
export const OVERLAP_MESSAGE = 'Ahí se superpone con otra mesa. Buscá un lugar libre.'

/**
 * Si la mesa, con su tamaño de ahora, pisaría a otra del sector puesta en (x, y).
 * Es la regla de los tres caminos para moverla: arrastrar, las flechas y los
 * campos del inspector.
 */
export function overlapsAt(
  table: GridTable & { id: string },
  x: number,
  y: number,
  neighbors: readonly (GridTable & { id: string })[],
) {
  return collidesWithAny({ x, y, footprint: tablePlacement(table).footprint }, occupiedBy(neighbors, table.id))
}

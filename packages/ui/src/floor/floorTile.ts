import { FLOOR_CELL, type Footprint, type Placed } from '@restaurant-platform/shared'

/** Posición ya resuelta de una mesa, en celdas y en píxeles del plano. */
export type FloorTile = {
  footprint: Footprint
  x: number
  y: number
  /** Caja final en píxeles, con la separación de 3px entre mesas ya aplicada. */
  box: { left: number; top: number; width: number; height: number }
  /** Clase de borde según la forma; el tamaño lo dan width y height. */
  shapeClass: string
}

/** Separación entre mesas vecinas, repartida a cada lado de la celda. */
const GAP = 6

/**
 * La única traducción de celdas a píxeles del plano. La usan el editor del
 * admin y el plano del POS, así el plano que se edita y el que se opera son el
 * mismo.
 *
 * `placed` es dónde se dibuja la mesa: su posición guardada (`tablePlacement`)
 * o la de un gesto en curso. La celda (0, 0) cae en el píxel (0, 0), aunque
 * haya mesas a la izquierda o arriba: la cámara corre y escala la vista
 * (`FloorPlan`).
 */
export function floorTile(table: { shape: string }, placed: Placed): FloorTile {
  const { footprint, x, y } = placed

  return {
    footprint,
    x,
    y,
    box: {
      left: x * FLOOR_CELL + GAP / 2,
      top: y * FLOOR_CELL + GAP / 2,
      width: footprint.w * FLOOR_CELL - GAP,
      height: footprint.h * FLOOR_CELL - GAP,
    },
    shapeClass: table.shape === 'round' ? 'rounded-full' : 'rounded-lg',
  }
}

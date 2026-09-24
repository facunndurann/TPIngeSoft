import type { ReactNode } from 'react'
import {
  FLOOR_GRID,
  tablePlacement,
  type Footprint,
  type Placed,
} from '@restaurant-platform/shared'

/** Lo mínimo para dibujar una mesa: el resto lo pone quien la renderiza. */
export type FloorGridTable = {
  id: string
  position_x: number
  position_y: number
  width: number
  height: number
  shape: string
}

/** Posición ya resuelta de una mesa, en celdas y en píxeles. */
export type FloorTile = {
  footprint: Footprint
  x: number
  y: number
  /** Caja final en píxeles, con la separación de 3px entre mesas ya aplicada. */
  box: { left: number; top: number; width: number; height: number }
  /** Clase de borde según la forma; el tamaño lo dan width y height. */
  shapeClass: string
}

type FloorGridProps<T extends FloorGridTable> = {
  tables: readonly T[]
  emptyMessage: string
  ariaLabel: string
  /**
   * Caja a dibujar en lugar de la guardada, mientras dura un gesto de arrastre
   * o de redimensionado. Devolver `null` usa la posición guardada.
   */
  preview?: (table: T) => Placed | null
  renderTable: (table: T, tile: FloorTile) => ReactNode
}

/** Separación entre mesas vecinas, repartida a cada lado de la celda. */
const GAP = 6

function tileOf(table: FloorGridTable, override?: Placed | null): FloorTile {
  // Recortada a la grilla al dibujar, no solo al editar: si la grilla se
  // achicara, una mesa vieja sigue visible en lugar de quedar fuera de la vista.
  const { footprint, x, y } = override ?? tablePlacement(table)

  return {
    footprint,
    x,
    y,
    box: {
      left: x * FLOOR_GRID.cell + GAP / 2,
      top: y * FLOOR_GRID.cell + GAP / 2,
      width: footprint.w * FLOOR_GRID.cell - GAP,
      height: footprint.h * FLOOR_GRID.cell - GAP,
    },
    shapeClass: table.shape === 'round' ? 'rounded-full' : 'rounded-lg',
  }
}

/**
 * Superficie del plano de salón. Es la única dueña de la grilla: su tamaño, su
 * fondo y la traducción de celdas a píxeles. Quien la usa solo decide cómo se
 * ve cada mesa — el admin le suma los gestos de edición y el POS los colores de
 * estado — para que el plano que se edita y el que se opera sean el mismo.
 */
export function FloorGrid<T extends FloorGridTable>({
  tables,
  emptyMessage,
  ariaLabel,
  preview,
  renderTable,
}: FloorGridProps<T>) {
  return (
    <div
      className="relative touch-none"
      style={{
        width: FLOOR_GRID.cols * FLOOR_GRID.cell,
        height: FLOOR_GRID.rows * FLOOR_GRID.cell,
        backgroundSize: `${FLOOR_GRID.cell}px ${FLOOR_GRID.cell}px`,
        backgroundImage:
          'linear-gradient(to right, #f1f1f1 1px, transparent 1px), linear-gradient(to bottom, #f1f1f1 1px, transparent 1px)',
      }}
      aria-label={ariaLabel}
    >
      {tables.map((table) => renderTable(table, tileOf(table, preview?.(table))))}

      {tables.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}

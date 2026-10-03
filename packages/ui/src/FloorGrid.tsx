import type { ReactNode } from 'react'
import {
  FLOOR_GRID,
  floorExtent,
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
  /** Lo que se lee en el plano sin mesas. Solo con `extent="fit"`: sin bordes, no hay dónde centrarlo. */
  emptyMessage?: string
  ariaLabel: string
  /**
   * Caja a dibujar en lugar de la guardada, mientras dura un gesto de arrastre
   * o de redimensionado. Devolver `null` usa la posición guardada.
   */
  preview?: (table: T) => Placed | null
  /**
   * La grilla nunca se queda con los gestos táctiles: un dedo que la recorre
   * desplaza el plano. Si las mesas se arrastran, quien las dibuja les pone
   * `touch-none` a ellas, no a la superficie.
   */
  renderTable: (table: T, tile: FloorTile) => ReactNode
  /**
   * El plano no tiene bordes, así que alguien decide qué parte se dibuja.
   *
   * - `fit`: una superficie con líneas finas que abarca el área de siempre
   *   (`FLOOR_GRID.cols` × `rows`) y, si alguna mesa queda afuera, también a
   *   ella. Es el plano del POS, que se recorre con el scroll.
   * - `unbounded`: un ancla sin tamaño ni fondo en la celda (0, 0); las mesas se
   *   dibujan en sus coordenadas, aunque sean negativas. Quien la contiene pone
   *   la cámara y el fondo, como el editor del admin.
   */
  extent?: 'fit' | 'unbounded'
}

/** Líneas finas de grilla: el fondo del plano del POS. */
const LINES = {
  backgroundSize: `${FLOOR_GRID.cell}px ${FLOOR_GRID.cell}px`,
  backgroundImage:
    'linear-gradient(to right, #f1f1f1 1px, transparent 1px), linear-gradient(to bottom, #f1f1f1 1px, transparent 1px)',
}

/** Separación entre mesas vecinas, repartida a cada lado de la celda. */
const GAP = 6

/** Celda que queda en la esquina de arriba a la izquierda de la superficie. */
type Origin = { x: number; y: number }

function tileOf(table: FloorGridTable, origin: Origin, override?: Placed | null): FloorTile {
  const { footprint, x, y } = override ?? tablePlacement(table)

  return {
    footprint,
    x,
    y,
    box: {
      left: (x - origin.x) * FLOOR_GRID.cell + GAP / 2,
      top: (y - origin.y) * FLOOR_GRID.cell + GAP / 2,
      width: footprint.w * FLOOR_GRID.cell - GAP,
      height: footprint.h * FLOOR_GRID.cell - GAP,
    },
    shapeClass: table.shape === 'round' ? 'rounded-full' : 'rounded-lg',
  }
}

/**
 * El área de siempre más la que haga falta para que entren todas las mesas, en
 * celdas. Se agranda para cualquier lado, también hacia columnas negativas.
 */
function fittedArea(tables: readonly FloorGridTable[]) {
  const extent = floorExtent(tables.map(tablePlacement))
  const x = Math.min(0, extent?.x ?? 0)
  const y = Math.min(0, extent?.y ?? 0)
  const right = Math.max(FLOOR_GRID.cols, extent ? extent.x + extent.w : 0)
  const bottom = Math.max(FLOOR_GRID.rows, extent ? extent.y + extent.h : 0)
  return { x, y, w: right - x, h: bottom - y }
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
  extent = 'fit',
}: FloorGridProps<T>) {
  const area = extent === 'fit' ? fittedArea(tables) : null
  const origin = area ?? { x: 0, y: 0 }

  return (
    <div
      // `touch-manipulation` deja desplazar el plano y quita la espera del doble
      // toque para hacer zoom. Con `touch-none` acá, en el editor ningún toque
      // desplazaba (la grilla es todo el plano) y en una tablet no se llegaba a
      // la parte que no entraba en pantalla.
      className="relative touch-manipulation"
      style={area ? { width: area.w * FLOOR_GRID.cell, height: area.h * FLOOR_GRID.cell, ...LINES } : undefined}
      aria-label={ariaLabel}
    >
      {tables.map((table) => renderTable(table, tileOf(table, origin, preview?.(table))))}

      {area && tables.length === 0 && emptyMessage && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}

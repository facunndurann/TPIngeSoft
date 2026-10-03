import type { ReactNode } from 'react'
import {
  FLOOR_CELL,
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

/** Celda que cae en el píxel (0, 0) de lo que se dibuja. */
type Origin = { x: number; y: number }

/** Separación entre mesas vecinas, repartida a cada lado de la celda. */
const GAP = 6

/**
 * La única traducción de celdas a píxeles del plano. La usan el plano del POS
 * (`FloorGrid`) y el editor del admin, así el plano que se edita y el que se
 * opera son el mismo.
 *
 * `placed` es dónde se dibuja la mesa: su posición guardada (`tablePlacement`)
 * o la de un gesto en curso. Sin `origin`, la celda (0, 0) cae en el píxel
 * (0, 0) y quien dibuja corre la vista, como la cámara del admin.
 */
export function floorTile(
  table: Pick<FloorGridTable, 'shape'>,
  placed: Placed,
  origin: Origin = { x: 0, y: 0 },
): FloorTile {
  const { footprint, x, y } = placed

  return {
    footprint,
    x,
    y,
    box: {
      left: (x - origin.x) * FLOOR_CELL + GAP / 2,
      top: (y - origin.y) * FLOOR_CELL + GAP / 2,
      width: footprint.w * FLOOR_CELL - GAP,
      height: footprint.h * FLOOR_CELL - GAP,
    },
    shapeClass: table.shape === 'round' ? 'rounded-full' : 'rounded-lg',
  }
}

/** Lo que el POS dibuja como mínimo, en celdas: el plano de siempre. */
const MIN_AREA = { w: 24, h: 16 } as const

/** Líneas finas de grilla: el fondo del plano del POS. */
const LINES = {
  backgroundSize: `${FLOOR_CELL}px ${FLOOR_CELL}px`,
  backgroundImage:
    'linear-gradient(to right, #f1f1f1 1px, transparent 1px), linear-gradient(to bottom, #f1f1f1 1px, transparent 1px)',
}

/**
 * El área mínima más la que haga falta para que entren todas las mesas, en
 * celdas. El plano no tiene bordes, así que se agranda para cualquier lado,
 * también hacia columnas o filas negativas.
 */
function fittedArea(tables: readonly FloorGridTable[]) {
  const extent = floorExtent(tables.map(tablePlacement))
  const x = Math.min(0, extent?.x ?? 0)
  const y = Math.min(0, extent?.y ?? 0)
  const right = Math.max(MIN_AREA.w, extent ? extent.x + extent.w : 0)
  const bottom = Math.max(MIN_AREA.h, extent ? extent.y + extent.h : 0)
  return { x, y, w: right - x, h: bottom - y }
}

type FloorGridProps<T extends FloorGridTable> = {
  tables: readonly T[]
  emptyMessage: string
  ariaLabel: string
  /**
   * Cómo se ve cada mesa; dónde va ya lo resolvió la grilla (`tile.box`). La
   * grilla nunca se queda con los gestos táctiles: un dedo que la recorre
   * desplaza el plano.
   */
  renderTable: (table: T, tile: FloorTile) => ReactNode
}

/**
 * El plano del POS: una superficie con líneas finas que abarca a todas las mesas
 * y se recorre con el scroll. Elige el área y el fondo; quien la usa decide cómo
 * se ve cada mesa (los colores de estado).
 */
export function FloorGrid<T extends FloorGridTable>({
  tables,
  emptyMessage,
  ariaLabel,
  renderTable,
}: FloorGridProps<T>) {
  const area = fittedArea(tables)

  return (
    <div
      // `touch-manipulation` deja desplazar el plano con el dedo y quita la espera
      // del doble toque para hacer zoom. Con `touch-none`, en una tablet no se
      // llegaba a la parte del plano que no entraba en pantalla.
      className="relative touch-manipulation"
      style={{ width: area.w * FLOOR_CELL, height: area.h * FLOOR_CELL, ...LINES }}
      aria-label={ariaLabel}
    >
      {/* La esquina de arriba a la izquierda del área es la celda del píxel (0, 0). */}
      {tables.map((table) => renderTable(table, floorTile(table, tablePlacement(table), area)))}

      {tables.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}

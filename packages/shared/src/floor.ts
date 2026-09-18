/**
 * Geometría del plano de salón (MI-66). La comparten el editor del admin y el
 * mapa operativo del POS, así que lo que el administrador guarda es exactamente
 * lo que después ve el mozo.
 *
 * Las posiciones y los tamaños se guardan en celdas de grilla, no en píxeles: el
 * plano se ve igual en una notebook y en una tablet, y no depende del zoom con
 * el que se editó.
 */

export const FLOOR_GRID = {
  cols: 24,
  rows: 16,
  /** Lado de celda en píxeles con zoom 1. */
  cell: 44,
} as const

/** Cada mesa declara su ancho y alto; no hay tamaños predefinidos. */
export const TABLE_SPAN = { min: 1, max: 12 } as const

/** Solo estilo visual: el tamaño lo dan width y height. */
export type TableShape = 'rect' | 'round'

export const tableShapes: readonly TableShape[] = ['rect', 'round'] as const

export const tableShapeLabels: Record<TableShape, string> = {
  rect: 'Rectangular',
  round: 'Redonda',
}

export function isTableShape(value: string): value is TableShape {
  return (tableShapes as readonly string[]).includes(value)
}

export type Footprint = { w: number; h: number }

export type TableSpan = { width: number; height: number }

/** Recorta un lado a algo dibujable dentro de la grilla. */
export function clampSpan(value: number, axisLimit: number) {
  const max = Math.min(TABLE_SPAN.max, axisLimit)
  if (!Number.isFinite(value)) return TABLE_SPAN.min
  return Math.min(Math.max(Math.round(value), TABLE_SPAN.min), max)
}

/** Celdas que ocupa una mesa, ya recortadas a la grilla. */
export function tableFootprint(table: TableSpan): Footprint {
  return {
    w: clampSpan(table.width, FLOOR_GRID.cols),
    h: clampSpan(table.height, FLOOR_GRID.rows),
  }
}

/** Mantiene la mesa entera dentro de la grilla. */
export function clampToGrid(x: number, y: number, footprint: Footprint) {
  const maxX = Math.max(0, FLOOR_GRID.cols - footprint.w)
  const maxY = Math.max(0, FLOOR_GRID.rows - footprint.h)
  return {
    x: Math.min(Math.max(Math.round(x), 0), maxX),
    y: Math.min(Math.max(Math.round(y), 0), maxY),
  }
}

type Placed = { x: number; y: number; footprint: Footprint }

function overlaps(a: Placed, b: Placed) {
  return (
    a.x < b.x + b.footprint.w &&
    b.x < a.x + a.footprint.w &&
    a.y < b.y + b.footprint.h &&
    b.y < a.y + a.footprint.h
  )
}

export function collidesWithAny(candidate: Placed, others: Placed[]) {
  return others.some((other) => overlaps(candidate, other))
}

/**
 * Primer hueco libre recorriendo la grilla, para ubicar una mesa nueva sin que
 * el administrador tenga que buscar espacio a mano.
 */
export function findFreeCell(footprint: Footprint, taken: Placed[]) {
  for (let y = 0; y <= FLOOR_GRID.rows - footprint.h; y += 1) {
    for (let x = 0; x <= FLOOR_GRID.cols - footprint.w; x += 1) {
      if (!collidesWithAny({ x, y, footprint }, taken)) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

/**
 * Regla única de qué mesa se puede operar (MI-66). Queda afuera la que está
 * fuera de servicio, la oculta del plano y la de un sector dado de baja. Una
 * mesa sin sector sigue siendo operable: existe y tiene su QR.
 */
export function isOperable(
  table: { is_active: boolean; is_visible: boolean },
  section?: { is_active: boolean } | null,
) {
  return table.is_active && table.is_visible && (!section || section.is_active)
}

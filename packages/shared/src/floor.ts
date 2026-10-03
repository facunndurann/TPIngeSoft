/**
 * Geometría del plano de salón (MI-66). La comparten el editor del admin y el
 * mapa operativo del POS, así que lo que el administrador guarda es exactamente
 * lo que después ve el mozo.
 *
 * Las posiciones y los tamaños se guardan en celdas de grilla, no en píxeles: el
 * plano se ve igual en una notebook y en una tablet, y no depende del zoom con
 * el que se editó.
 */

/**
 * El plano no tiene bordes: una mesa va donde se la deje, también en columnas o
 * filas negativas. `cols` y `rows` son solo el área que el POS dibuja como
 * mínimo; si las mesas pasan de ahí, el plano se agranda hasta abarcarlas.
 */
export const FLOOR_GRID = {
  cols: 24,
  rows: 16,
  /** Lado de celda en píxeles con zoom 1. */
  cell: 44,
} as const

/**
 * Rango de posiciones que acepta la base (`tables_position_range`). No es un
 * borde del plano sino un tope sano: un dato roto no manda una mesa a millones
 * de celdas.
 */
export const FLOOR_BOUNDS = { min: -10000, max: 10000 } as const

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

/** Lo mínimo para ubicar una mesa guardada en el plano. */
export type GridTable = TableSpan & { position_x: number; position_y: number }

/** Lugar que ocupa una mesa en el plano, en celdas. */
export type Placed = { x: number; y: number; footprint: Footprint }

/** Recorta un lado a un tamaño de mesa válido. */
export function clampSpan(value: number) {
  if (!Number.isFinite(value)) return TABLE_SPAN.min
  return Math.min(Math.max(Math.round(value), TABLE_SPAN.min), TABLE_SPAN.max)
}

/** Celdas que ocupa una mesa, con su tamaño recortado a uno válido. */
export function tableFootprint(table: TableSpan): Footprint {
  return { w: clampSpan(table.width), h: clampSpan(table.height) }
}

/** Una posición entera dentro del rango que acepta la base. */
export function clampToFloor(x: number, y: number) {
  const clamp = (value: number) =>
    Number.isFinite(value) ? Math.min(Math.max(Math.round(value), FLOOR_BOUNDS.min), FLOOR_BOUNDS.max) : 0
  return { x: clamp(x), y: clamp(y) }
}

/**
 * Dónde está una mesa tal como se dibuja. Es la única lectura de la posición
 * guardada, así que el plano que se ve, las colisiones y los huecos libres usan
 * la misma: un tamaño fuera de rango choca con el tamaño con que se lo ve.
 */
export function tablePlacement(table: GridTable): Placed {
  return { footprint: tableFootprint(table), ...clampToFloor(table.position_x, table.position_y) }
}

/**
 * Lo que ocupan las mesas de un sector, sin contar `exceptId`: la que se está
 * moviendo no puede chocar consigo misma.
 */
export function occupiedBy(tables: readonly (GridTable & { id: string })[], exceptId?: string) {
  return tables.filter((table) => table.id !== exceptId).map(tablePlacement)
}

/** La caja, en celdas, que abarca a todas las mesas; `null` si no hay ninguna. */
export function floorExtent(placed: readonly Placed[]) {
  if (placed.length === 0) return null
  const left = Math.min(...placed.map((table) => table.x))
  const top = Math.min(...placed.map((table) => table.y))
  const right = Math.max(...placed.map((table) => table.x + table.footprint.w))
  const bottom = Math.max(...placed.map((table) => table.y + table.footprint.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

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
 * El hueco libre más cercano a `near` (la esquina que se querría), para ubicar
 * una mesa nueva sin que el administrador tenga que buscar espacio a mano. Se
 * busca en anillos cada vez más grandes alrededor de ese punto; como las mesas
 * son finitas y el plano no, siempre hay uno.
 */
export function findFreeCell(footprint: Footprint, taken: Placed[], near = { x: 0, y: 0 }) {
  const start = clampToFloor(near.x, near.y)
  // Más allá de las mesas que hay, todo está libre: ese es el anillo más lejano posible.
  const reach =
    taken.reduce((far, table) => Math.max(far, Math.abs(table.x - start.x), Math.abs(table.y - start.y)), 0) +
    Math.max(footprint.w, footprint.h) +
    TABLE_SPAN.max
  for (let ring = 0; ring <= reach; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const spot = clampToFloor(start.x + dx, start.y + dy)
        if (!collidesWithAny({ ...spot, footprint }, taken)) return spot
      }
    }
  }
  return start
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

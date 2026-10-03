import {
  clampSpan,
  clampToFloor,
  collidesWithAny,
  occupiedBy,
  tablePlacement,
  type GridTable,
  type Placed,
} from '@restaurant-platform/shared'
import type { TablePatch } from '@/queries/floor'

/**
 * Dónde puede ir una mesa. Todo lo que le propone otro lugar o tamaño (soltarla
 * después de arrastrarla o estirarla, las flechas, deshacer y rehacer) lo
 * expresa como un `Placed`, y pasa por la misma regla: `fitsAt`.
 */

/** Lo que se le dice a quien intenta dejar una mesa encima de otra, de cualquier forma. */
export const OVERLAP_MESSAGE = 'Ahí se superpone con otra mesa. Buscá un lugar libre.'

/** Si la mesa entra en `placed` sin pisar a otra del sector; ella misma no cuenta. */
export function fitsAt(
  table: { id: string },
  placed: Placed,
  neighbors: readonly (GridTable & { id: string })[],
) {
  return !collidesWithAny(placed, occupiedBy(neighbors, table.id))
}

/**
 * Las columnas que cambian si la mesa pasa a ocupar `placed`, o `null` si
 * ninguna. Se escribe solo eso: dos teclas seguidas llegan antes de que la
 * primera se vea, y mandar la caja entera pisaba el ancho de la primera con el
 * viejo.
 */
export function changesTo(table: GridTable, placed: Placed): TablePatch | null {
  const now = tablePlacement(table)
  const changes: TablePatch = {}
  if (placed.x !== now.x) changes.position_x = placed.x
  if (placed.y !== now.y) changes.position_y = placed.y
  if (placed.footprint.w !== now.footprint.w) changes.width = placed.footprint.w
  if (placed.footprint.h !== now.footprint.h) changes.height = placed.footprint.h
  return Object.keys(changes).length > 0 ? changes : null
}

/** Hacia dónde crece la mesa al tirar de una esquina: 1 a la derecha o abajo, -1 al revés. */
export type Corner = { dx: 1 | -1; dy: 1 | -1 }

/**
 * De dónde se agarró una mesa: un punto de ella, para moverla (`offset` es la
 * distancia a su esquina de arriba a la izquierda, en celdas), o una esquina,
 * para estirarla.
 */
export type Grip =
  | { kind: 'move'; offset: { x: number; y: number } }
  | { kind: 'resize'; corner: Corner }

/**
 * Un lado de la mesa que se estira: el borde opuesto queda quieto y el que se
 * agarra sigue al puntero.
 */
function stretch(pointer: number, start: number, size: number, grow: 1 | -1) {
  if (grow > 0) return { start, size: clampSpan(pointer - start) }
  const end = start + size
  const next = clampSpan(end - pointer)
  return { start: end - next, size: next }
}

/**
 * Dónde quedaría la mesa con el puntero en `pointer` (una celda, con
 * decimales), según de dónde se la agarró: movida conserva su tamaño, estirada
 * conserva el borde opuesto a la esquina.
 */
export function followPointer(origin: Placed, grip: Grip, pointer: { x: number; y: number }): Placed {
  if (grip.kind === 'move') {
    return { footprint: origin.footprint, ...clampToFloor(pointer.x - grip.offset.x, pointer.y - grip.offset.y) }
  }
  const across = stretch(pointer.x, origin.x, origin.footprint.w, grip.corner.dx)
  const down = stretch(pointer.y, origin.y, origin.footprint.h, grip.corner.dy)
  return { x: across.start, y: down.start, footprint: { w: across.size, h: down.size } }
}

/** Un paso de una celda, el de una flecha: hacia dónde en cada eje. */
export type Step = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }

/**
 * Qué hace un paso: correr la mesa (`move`) o estirarla (`stretch`), que mueve
 * su borde de la derecha o el de abajo: → y ↓ la agrandan, ← y ↑ la achican.
 * Las flechas del teclado (Mayús estira) y las del panel hacen lo mismo.
 */
export type NudgeKind = 'move' | 'stretch'

export function nudged(placed: Placed, step: Step, kind: NudgeKind): Placed {
  if (kind === 'move') {
    return { footprint: placed.footprint, ...clampToFloor(placed.x + step.dx, placed.y + step.dy) }
  }
  return {
    x: placed.x,
    y: placed.y,
    footprint: { w: clampSpan(placed.footprint.w + step.dx), h: clampSpan(placed.footprint.h + step.dy) },
  }
}

/**
 * La mesa una celda más grande hacia una esquina, con el borde opuesto quieto:
 * lo que hace tocar una manija sin arrastrarla. En el tamaño máximo, no cambia.
 */
export function grownToward(placed: Placed, corner: Corner): Placed {
  const w = clampSpan(placed.footprint.w + 1)
  const h = clampSpan(placed.footprint.h + 1)
  return {
    x: corner.dx > 0 ? placed.x : placed.x + placed.footprint.w - w,
    y: corner.dy > 0 ? placed.y : placed.y + placed.footprint.h - h,
    footprint: { w, h },
  }
}

/**
 * Una mesa que no entró donde se la quiso llevar, para marcarla en el plano.
 * `key` cambia con cada rechazo: dos seguidos de la misma mesa (una flecha
 * apretada dos veces contra otra) también se marcan los dos.
 */
export type Refusal = { tableId: string; key: number }

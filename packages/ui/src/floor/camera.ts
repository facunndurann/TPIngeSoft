import { FLOOR_CELL, floorExtent, type Placed } from '@restaurant-platform/shared'

/**
 * Las cuentas de la cámara del plano: qué parte del plano cae en el recuadro.
 * Todo acá es puro; los gestos que la mueven viven en `useFloorCamera`.
 */

/**
 * Lo que se ve del plano: dónde cae la celda (0, 0) dentro del recuadro, en
 * píxeles, y el zoom. El plano no tiene bordes, así que no hay scroll: moverse
 * es correr la cámara.
 */
export type Camera = { x: number; y: number; zoom: number }

/** Un punto del recuadro, en píxeles desde su esquina de arriba a la izquierda, o una celda con decimales. */
export type Point = { x: number; y: number }

/** Lo que mide el recuadro, en píxeles. */
export type ViewSize = { width: number; height: number }

export const ZOOM = { min: 0.3, max: 1.5, step: 0.1 } as const

/** Encuadrar no acerca más que esto: un sector con una sola mesa no la muestra gigante. */
const FIT_MAX_ZOOM = 1

/** Aire alrededor de las mesas al encuadrar: las sillas quedan afuera de su caja. */
const PADDING = 28

/** Antes de medir el recuadro, o sin mesas: el origen del plano, con aire, a tamaño real. */
export const HOME: Camera = { x: PADDING, y: PADDING, zoom: 1 }

export const clampZoom = (zoom: number) => Math.min(Math.max(zoom, ZOOM.min), ZOOM.max)

/** La celda, con decimales, que cae en un punto del recuadro. */
export function cellAt(camera: Camera, point: Point): Point {
  const cell = FLOOR_CELL * camera.zoom
  return { x: (point.x - camera.x) / cell, y: (point.y - camera.y) / cell }
}

/** La cámara corrida `dx`, `dy` píxeles: lo que se ve acompaña al puntero. */
export function panned(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

/** La cámara con otro zoom, sin que se mueva lo que hay en `at` (un punto del recuadro). */
export function zoomedAround(camera: Camera, zoom: number, at: Point): Camera {
  const next = clampZoom(zoom)
  return {
    zoom: next,
    x: at.x - ((at.x - camera.x) / camera.zoom) * next,
    y: at.y - ((at.y - camera.y) / camera.zoom) * next,
  }
}

const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Dos dedos que pasaron de `before` a `after` (puntos del recuadro): la
 * distancia entre ellos es el zoom y su punto medio arrastra.
 */
export function pinched(camera: Camera, before: readonly [Point, Point], after: readonly [Point, Point]): Camera {
  const from = middle(...before)
  const to = middle(...after)
  const factor = distance(...after) / (distance(...before) || 1)
  return panned(zoomedAround(camera, camera.zoom * factor, from), to.x - from.x, to.y - from.y)
}

/** Aire alrededor de lo que se revela, en píxeles de pantalla: que se vean también las sillas y el contorno del foco. */
const REVEAL_MARGIN = 24

/** Lo que hay que correr un eje para que [start, end] quede dentro de [0, size]; si no entra, que se vea el principio. */
const shiftInto = (start: number, end: number, size: number) =>
  start < 0 || end - start > size ? -start : end > size ? size - end : 0

/**
 * La cámara corrida lo justo para que `placed` se vea entero en el recuadro, con
 * aire. Si ya se ve, la misma cámara: así quien la pide sabe que no hay nada que
 * mover. Si no entra entero, se ve su esquina de arriba a la izquierda.
 */
export function revealed(camera: Camera, placed: Placed, view: ViewSize): Camera {
  const cell = FLOOR_CELL * camera.zoom
  const dx = shiftInto(
    camera.x + placed.x * cell - REVEAL_MARGIN,
    camera.x + (placed.x + placed.footprint.w) * cell + REVEAL_MARGIN,
    view.width,
  )
  const dy = shiftInto(
    camera.y + placed.y * cell - REVEAL_MARGIN,
    camera.y + (placed.y + placed.footprint.h) * cell + REVEAL_MARGIN,
    view.height,
  )
  return dx === 0 && dy === 0 ? camera : panned(camera, dx, dy)
}

/** La cámara que muestra todas las mesas, centradas en el recuadro; sin mesas, `HOME`. */
export function framing(tables: readonly Placed[], view: ViewSize): Camera {
  const extent = floorExtent(tables)
  if (!extent) return HOME
  const width = extent.w * FLOOR_CELL + PADDING * 2
  const height = extent.h * FLOOR_CELL + PADDING * 2
  const zoom = clampZoom(Math.min(view.width / width, view.height / height, FIT_MAX_ZOOM))
  return {
    zoom,
    x: view.width / 2 - (extent.x + extent.w / 2) * FLOOR_CELL * zoom,
    y: view.height / 2 - (extent.y + extent.h / 2) * FLOOR_CELL * zoom,
  }
}

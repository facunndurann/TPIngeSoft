import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  FLOOR_GRID,
  clampSpan,
  clampToGrid,
  collidesWithAny,
  tableFootprint,
  type Footprint,
} from '@restaurant-platform/shared'
import { FloorGrid } from '@restaurant-platform/ui'
import type { FloorTable } from './floor-api'

type Gesture =
  | {
      kind: 'move'
      tableId: string
      /** Distancia entre el punto agarrado y la esquina de la mesa, en celdas. */
      offsetX: number
      offsetY: number
      x: number
      y: number
      valid: boolean
    }
  | {
      kind: 'resize'
      tableId: string
      width: number
      height: number
      valid: boolean
    }

type FloorCanvasProps = {
  tables: FloorTable[]
  selectedId: string | null
  onSelect: (tableId: string) => void
  /** Ausente en modo visualizar: el plano queda de solo lectura. */
  onMove?: (tableId: string, x: number, y: number) => void
  onResize?: (tableId: string, width: number, height: number) => void
  onReject?: (message: string) => void
}

const ARROW_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

const OVERLAP_MESSAGE = 'Ahí se superpone con otra mesa. Buscá un lugar libre.'

/**
 * Plano del sector. Las mesas se arrastran y se estiran sobre una grilla: se
 * guarda la celda, no el píxel, así el plano se ve igual en cualquier pantalla.
 *
 * Las posiciones y tamaños se recortan a la grilla al dibujar, no solo al
 * editar: si la grilla se achicara, una mesa vieja seguiría siendo visible y
 * editable en vez de quedar fuera de la vista.
 */
export function FloorCanvas({
  tables,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onReject,
}: FloorCanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const editable = !!onMove

  const layoutOf = (table: FloorTable) => {
    const footprint = tableFootprint(table)
    return { footprint, ...clampToGrid(table.position_x, table.position_y, footprint) }
  }

  const obstaclesFor = (tableId: string) =>
    tables.filter((other) => other.id !== tableId).map(layoutOf)

  const cellFromPointer = (event: { clientX: number; clientY: number }) => {
    const grid = surface.current?.firstElementChild?.getBoundingClientRect()
    if (!grid) return { x: 0, y: 0 }
    const cell = grid.width / FLOOR_GRID.cols
    return { x: (event.clientX - grid.left) / cell, y: (event.clientY - grid.top) / cell }
  }

  /** Caja del gesto en curso; sin gesto, FloorGrid dibuja la posición guardada. */
  const previewOf = (table: FloorTable) => {
    if (gesture?.tableId !== table.id) return null
    const saved = layoutOf(table)
    return gesture.kind === 'move'
      ? { footprint: saved.footprint, x: gesture.x, y: gesture.y }
      : { footprint: { w: gesture.width, h: gesture.height }, x: saved.x, y: saved.y }
  }

  function startMove(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    onSelect(table.id)
    if (!editable) return
    const origin = layoutOf(table)
    const pointer = cellFromPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({
      kind: 'move',
      tableId: table.id,
      offsetX: pointer.x - origin.x,
      offsetY: pointer.y - origin.y,
      x: origin.x,
      y: origin.y,
      valid: true,
    })
  }

  function moveTo(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    if (gesture?.kind !== 'move' || gesture.tableId !== table.id) return
    const pointer = cellFromPointer(event)
    const footprint: Footprint = tableFootprint(table)
    const next = clampToGrid(pointer.x - gesture.offsetX, pointer.y - gesture.offsetY, footprint)
    setGesture({
      ...gesture,
      ...next,
      valid: !collidesWithAny({ ...next, footprint }, obstaclesFor(table.id)),
    })
  }

  function startResize(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    event.stopPropagation()
    const { footprint } = layoutOf(table)
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({
      kind: 'resize',
      tableId: table.id,
      width: footprint.w,
      height: footprint.h,
      valid: true,
    })
  }

  function resizeTo(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    if (gesture?.kind !== 'resize' || gesture.tableId !== table.id) return
    event.stopPropagation()
    const pointer = cellFromPointer(event)
    const origin = layoutOf(table)
    // La esquina superior izquierda no se mueve: el lado es la distancia hasta
    // el puntero, recortada a lo que queda de grilla.
    const width = clampSpan(pointer.x - origin.x, FLOOR_GRID.cols - origin.x)
    const height = clampSpan(pointer.y - origin.y, FLOOR_GRID.rows - origin.y)
    setGesture({
      ...gesture,
      width,
      height,
      valid: !collidesWithAny(
        { x: origin.x, y: origin.y, footprint: { w: width, h: height } },
        obstaclesFor(table.id),
      ),
    })
  }

  function endGesture(table: FloorTable) {
    if (gesture?.tableId !== table.id) return
    const origin = layoutOf(table)

    if (gesture.kind === 'move') {
      const moved = gesture.x !== origin.x || gesture.y !== origin.y
      if (moved && gesture.valid) onMove?.(table.id, gesture.x, gesture.y)
      if (moved && !gesture.valid) onReject?.(OVERLAP_MESSAGE)
    } else {
      const resized = gesture.width !== origin.footprint.w || gesture.height !== origin.footprint.h
      if (resized && gesture.valid) onResize?.(table.id, gesture.width, gesture.height)
      if (resized && !gesture.valid) onReject?.(OVERLAP_MESSAGE)
    }
    setGesture(null)
  }

  /** Mover con flechas: precisión fina y la única vía sin mouse. */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>, table: FloorTable) {
    if (!editable) return
    const step = ARROW_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const origin = layoutOf(table)
    const next = clampToGrid(origin.x + step.dx, origin.y + step.dy, origin.footprint)
    if (next.x === origin.x && next.y === origin.y) return
    if (collidesWithAny({ ...next, footprint: origin.footprint }, obstaclesFor(table.id))) {
      onReject?.(OVERLAP_MESSAGE)
      return
    }
    onMove?.(table.id, next.x, next.y)
  }

  return (
    <div ref={surface} className="overflow-auto rounded-xl border border-neutral-200 bg-white p-3">
      <FloorGrid
        tables={tables}
        ariaLabel="Plano del sector"
        emptyMessage="Este sector todavía no tiene mesas."
        preview={previewOf}
        renderTable={(table, tile) => {
          const active = gesture?.tableId === table.id
          const invalid = active && !gesture.valid
          const selected = selectedId === table.id
          const muted = !table.is_active || !table.is_visible

          return (
            <div key={table.id} className="contents">
              <button
                type="button"
                onPointerDown={(event) => startMove(event, table)}
                onPointerMove={(event) => moveTo(event, table)}
                onPointerUp={() => endGesture(table)}
                onPointerCancel={() => setGesture(null)}
                onKeyDown={(event) => handleKeyDown(event, table)}
                className={`absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                  editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                } ${tile.shapeClass} ${
                  invalid
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : selected
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                      : muted
                        ? 'border-dashed border-neutral-300 bg-neutral-50 text-neutral-400'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400'
                }`}
                style={{ ...tile.box, zIndex: active ? 10 : 1 }}
                aria-label={`${table.label}, ${table.seats} lugares${muted ? ', no operable' : ''}${
                  editable ? '. Flechas para mover.' : ''
                }`}
              >
                <span className="px-1 text-xs leading-tight font-semibold">{table.label}</span>
                <span className="text-[10px] leading-tight opacity-70">{table.seats} lug.</span>
              </button>

              {/* Manija de tamaño: solo sobre la mesa elegida, para no ensuciar el plano. */}
              {editable && selected && (
                <span
                  role="slider"
                  aria-label={`Tamaño de ${table.label}: ${tile.footprint.w} por ${tile.footprint.h} celdas`}
                  aria-valuetext={`${tile.footprint.w} por ${tile.footprint.h} celdas`}
                  aria-valuenow={tile.footprint.w}
                  tabIndex={-1}
                  onPointerDown={(event) => startResize(event, table)}
                  onPointerMove={(event) => resizeTo(event, table)}
                  onPointerUp={() => endGesture(table)}
                  onPointerCancel={() => setGesture(null)}
                  className="absolute h-3.5 w-3.5 cursor-se-resize rounded-sm border-2 border-white bg-indigo-600 shadow"
                  style={{
                    left: tile.box.left + tile.box.width - 4,
                    top: tile.box.top + tile.box.height - 4,
                    zIndex: active ? 11 : 2,
                  }}
                />
              )}
            </div>
          )
        }}
      />
    </div>
  )
}

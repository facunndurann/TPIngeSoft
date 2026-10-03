import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { FLOOR_CELL, clampSpan, clampToFloor, tablePlacement, type Placed } from '@restaurant-platform/shared'
import { Minus, Plus } from 'lucide-react'
import { floorTile } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { ZOOM, type Camera } from './camera'
import { FloorTableTile } from './FloorTableTile'
import { fitsAt, followPointer, type Grip } from './placement'
import { cardClass, pillClass, roundIconClass } from './styles'
import type { FloorCamera } from './useFloorCamera'

/** Una mesa agarrada: de dónde, dónde quedaría si se la suelta ahora y si ahí entra. */
type Gesture = { tableId: string; grip: Grip; placed: Placed; valid: boolean }

/** Lo que el plano necesita para editar. Sin esto es de solo lectura. */
export type FloorEditing = {
  selectedId: string | null
  /** Elige una mesa; con `null` la suelta (un toque en el piso vacío). */
  onSelect: (tableId: string | null) => void
  /**
   * Propone otro lugar o tamaño para una mesa: al soltarla después de arrastrarla
   * o estirarla, y con las flechas. Quien edita valida y escribe; el plano solo
   * pinta de rojo, mientras dura el gesto, un lugar donde no entraría.
   */
  onPlace: (table: FloorTable, placed: Placed) => void
}

type FloorCanvasProps = {
  tables: FloorTable[]
  /** Qué parte del plano se ve. Es de quien dibuja el plano (ver `useFloorCamera`). */
  camera: FloorCamera
  /** Sin `editing`, el plano es de solo lectura: las mesas no son botones ni se eligen. */
  editing?: FloorEditing
  /** Barra de arriba de la tarjeta: las acciones y el estado del sector. */
  toolbar?: ReactNode
  /** Lo que va a la izquierda del zoom, abajo: deshacer y rehacer. */
  footerStart?: ReactNode
}

const ARROW_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

/**
 * Damero del fondo, un cuadro por celda. Es del recuadro y no de las mesas, así
 * que no se termina nunca; corre con la cámara para quedar alineado a las celdas.
 */
const checker = ({ x, y, zoom }: Camera) => ({
  backgroundColor: 'var(--color-neutral-50)',
  backgroundImage:
    'conic-gradient(var(--color-neutral-100) 25%, transparent 0 50%, var(--color-neutral-100) 0 75%, transparent 0)',
  backgroundSize: `${FLOOR_CELL * 2 * zoom}px ${FLOOR_CELL * 2 * zoom}px`,
  backgroundPosition: `${x}px ${y}px`,
})

/**
 * Plano del sector dentro de su tarjeta. Compone la cámara que recibe (qué se ve
 * y cómo se recorre), las mesas (`FloorTableTile`) y los gestos que las mueven y
 * las estiran. El plano no tiene bordes: las mesas van a cualquier lado, sobre
 * una grilla. Se guarda la celda, no el píxel, así se ve igual en cualquier
 * pantalla.
 */
export function FloorCanvas({ tables, camera, editing, toolbar, footerStart }: FloorCanvasProps) {
  const [gesture, setGesture] = useState<Gesture | null>(null)

  /** Dónde se dibuja una mesa: donde la lleva el gesto en curso o, sin gesto, donde está guardada. */
  const placementOf = (table: FloorTable) => (gesture?.tableId === table.id ? gesture.placed : tablePlacement(table))

  /**
   * Agarra una mesa. El apretón es solo de ella: no sigue hasta el piso, que si
   * no también arrastraría el plano o soltaría la mesa elegida. El puntero queda
   * capturado por la mesa hasta que la suelta.
   */
  function grab(event: ReactPointerEvent<HTMLElement>, table: FloorTable, grip: Grip) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({ tableId: table.id, grip, placed: tablePlacement(table), valid: true })
  }

  /** Para moverla, se la agarra por el punto donde se apoyó el puntero. */
  function moveGrip(event: ReactPointerEvent<HTMLElement>, table: FloorTable): Grip {
    const pointer = camera.cellFromPointer(event)
    const { x, y } = tablePlacement(table)
    return { kind: 'move', offset: { x: pointer.x - x, y: pointer.y - y } }
  }

  function drag(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    if (gesture?.tableId !== table.id) return
    const placed = followPointer(tablePlacement(table), gesture.grip, camera.cellFromPointer(event))
    setGesture({ ...gesture, placed, valid: fitsAt(table, placed, tables) })
  }

  /** Suelta la mesa y propone dónde quedó; si no cambió nada, quien edita no escribe. */
  function drop(table: FloorTable, onPlace: FloorEditing['onPlace']) {
    if (gesture?.tableId !== table.id) return
    onPlace(table, gesture.placed)
    setGesture(null)
  }

  /**
   * Las flechas mueven la mesa una celda; con Mayús, la agrandan o achican desde
   * el borde de la derecha o el de abajo. Es la vía sin arrastrar (WCAG 2.5.7).
   */
  function nudge(event: KeyboardEvent<HTMLElement>, table: FloorTable, onPlace: FloorEditing['onPlace']) {
    const step = ARROW_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const { x, y, footprint } = tablePlacement(table)
    onPlace(
      table,
      event.shiftKey
        ? { x, y, footprint: { w: clampSpan(footprint.w + step.dx), h: clampSpan(footprint.h + step.dy) } }
        : { footprint, ...clampToFloor(x + step.dx, y + step.dy) },
    )
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${cardClass}`}>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2.5">
          {toolbar}
        </div>
      )}

      {/* El recuadro es una ventana a un plano sin bordes: no hay scroll ni barras,
          la cámara corre el contenido y el damero. Los gestos táctiles son todos
          del plano (`touch-none`): un dedo lo arrastra y dos lo pellizcan. Al piso
          solo llegan los apretones que no agarró una mesa. */}
      <div
        ref={camera.viewportRef}
        data-floor-viewport
        className={`relative min-h-48 flex-1 touch-none overflow-hidden select-none ${
          camera.panning ? 'cursor-grabbing **:cursor-grabbing' : camera.spaceHeld ? 'cursor-grab **:cursor-grab' : ''
        }`}
        style={checker(camera)}
        onPointerDownCapture={camera.grabWithSpace}
        onPointerDown={camera.grab}
        onPointerMove={camera.drag}
        onPointerUp={(event) => {
          // Un toque en el piso que no lo movió suelta la mesa elegida.
          if (camera.release(event)) editing?.onSelect(null)
        }}
        onPointerCancel={camera.release}
      >
        {/* Las mesas van en sus coordenadas del plano (`floorTile` sin origen), aunque
            sean negativas: es la cámara la que corre y escala esta capa. */}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, transformOrigin: '0 0' }}
        >
          {tables.map((table) => {
            const active = gesture?.tableId === table.id
            return (
              <FloorTableTile
                key={table.id}
                table={table}
                tile={floorTile(table, placementOf(table))}
                active={active}
                invalid={active && !gesture.valid}
                editing={
                  editing && {
                    selected: editing.selectedId === table.id,
                    onGrab: (event) => {
                      editing.onSelect(table.id)
                      grab(event, table, moveGrip(event, table))
                    },
                    onGrabCorner: (event, corner) => grab(event, table, { kind: 'resize', corner }),
                    onDrag: (event) => drag(event, table),
                    onDrop: () => drop(table, editing.onPlace),
                    onCancel: () => setGesture(null),
                    onNudge: (event) => nudge(event, table, editing.onPlace),
                  }
                }
              />
            )
          })}
        </div>
        {tables.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            Este sector todavía no tiene mesas.
          </p>
        )}
      </div>

      <div
        className={`flex flex-wrap items-center gap-3 border-t border-neutral-200 px-3 py-2 ${
          footerStart ? 'justify-between' : 'justify-end'
        }`}
      >
        {footerStart}
        <ZoomControls camera={camera} />
      </div>
    </div>
  )
}

/** Alejar, acercar y volver a encuadrar todas las mesas. */
function ZoomControls({ camera }: { camera: FloorCamera }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Zoom del plano">
      <button
        type="button"
        className={roundIconClass}
        aria-label="Alejar"
        title="Alejar"
        disabled={camera.zoom <= ZOOM.min}
        onClick={() => camera.zoomBy(-ZOOM.step)}
      >
        <Minus size={18} aria-hidden="true" />
      </button>
      <span aria-live="polite" className="min-w-14 text-center text-sm font-semibold text-neutral-900 tabular-nums">
        {Math.round(camera.zoom * 100)} %
      </span>
      <button
        type="button"
        className={roundIconClass}
        aria-label="Acercar"
        title="Acercar"
        disabled={camera.zoom >= ZOOM.max}
        onClick={() => camera.zoomBy(ZOOM.step)}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
      <button type="button" className={`ml-1 ${pillClass('secondary')}`} onClick={camera.fit}>
        Ajustar al salón
      </button>
    </div>
  )
}

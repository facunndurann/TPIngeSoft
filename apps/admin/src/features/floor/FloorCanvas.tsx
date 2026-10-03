import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { tablePlacement, type Placed } from '@restaurant-platform/shared'
import { FloorPlan, floorTile, type FloorCamera } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { changesTo, fitsAt, followPointer, grownToward, nudged, type Grip, type Refusal, type Step } from './placement'
import { EditableTableTile } from './TableTile'

/**
 * Una mesa agarrada: de dónde, dónde quedaría si se la suelta ahora, si ahí entra
 * y si llegó a moverse (soltarla sin moverla es un toque, no un arrastre).
 */
type Gesture = { tableId: string; grip: Grip; placed: Placed; valid: boolean; moved: boolean }

/** Lo que el editor del plano necesita de quien edita: la mesa elegida, y dónde se escribe. */
export type FloorEditing = {
  selectedId: string | null
  /** Elige una mesa; con `null` la suelta (un toque en el piso vacío). */
  onSelect: (tableId: string | null) => void
  /**
   * Propone otro lugar o tamaño para una mesa: al soltarla después de arrastrarla
   * o estirarla, y con las flechas. Quien edita valida y escribe; el plano solo
   * marca, mientras dura el gesto, un lugar donde no entraría.
   */
  onPlace: (table: FloorTable, placed: Placed) => void
  /**
   * La última mesa que no entró donde se la quiso llevar, desde el plano, el
   * panel o deshacer: el plano la marca sobre ella. Cuando la marca terminó de
   * verse, `onRefusalShown`, y quien edita la olvida.
   */
  refusal: Refusal | null
  onRefusalShown: () => void
}

type FloorCanvasProps = {
  tables: FloorTable[]
  /** Qué parte del plano se ve. Es de quien dibuja el plano (ver `useFloorCamera`). */
  camera: FloorCamera
  editing: FloorEditing
  /** Barra de arriba de la tarjeta: las acciones y el estado del sector. */
  toolbar?: ReactNode
  /** Lo que va a la izquierda del zoom, abajo: deshacer y rehacer. */
  footerStart?: ReactNode
}

const ARROW_STEPS: Record<string, Step> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

/**
 * El plano del editor: el mismo de la vista y del POS (`FloorPlan`, con su cámara
 * y su zoom), con mesas que se eligen (`EditableTableTile`) y los gestos que las
 * mueven y las estiran. El plano no tiene bordes: las mesas van a cualquier lado,
 * sobre una grilla. Se guarda la celda, no el píxel, así se ve igual en cualquier
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
    setGesture({ tableId: table.id, grip, placed: tablePlacement(table), valid: true, moved: false })
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
    setGesture({
      ...gesture,
      placed,
      valid: fitsAt(table, placed, tables),
      moved: gesture.moved || changesTo(table, placed) !== null,
    })
  }

  /** Suelta la mesa y propone dónde quedó; si no cambió nada, quien edita no escribe. */
  function drop(table: FloorTable) {
    if (gesture?.tableId !== table.id) return
    const { grip, placed, moved } = gesture
    // Tocar una manija sin arrastrarla estira la mesa una celda hacia esa esquina:
    // agrandarla no exige arrastrar (WCAG 2.5.7).
    editing.onPlace(table, grip.kind === 'resize' && !moved ? grownToward(tablePlacement(table), grip.corner) : placed)
    setGesture(null)
  }

  /**
   * Las flechas mueven la mesa una celda; con Mayús, la agrandan o achican desde
   * el borde de la derecha o el de abajo. Es la vía sin arrastrar (WCAG 2.5.7).
   */
  function nudge(event: KeyboardEvent<HTMLElement>, table: FloorTable) {
    const step = ARROW_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const next = nudged(tablePlacement(table), step, event.shiftKey ? 'stretch' : 'move')
    editing.onPlace(table, next)
    // La mesa sigue con el foco: que no se vaya de la vista (WCAG 2.4.11).
    camera.reveal(next)
  }

  return (
    <FloorPlan
      camera={camera}
      tables={tables}
      emptyMessage="Este sector todavía no tiene mesas."
      // Al piso solo llegan los toques del piso vacío (el apretón sobre una mesa es
      // de la mesa, para moverla): sueltan la mesa elegida.
      onTap={() => editing.onSelect(null)}
      toolbar={toolbar}
      footerStart={footerStart}
      renderTable={(table) => {
        const active = gesture?.tableId === table.id
        return (
          <EditableTableTile
            table={table}
            tile={floorTile(table, placementOf(table))}
            zoom={camera.zoom}
            active={active}
            invalid={active && !gesture.valid}
            editing={{
              selected: editing.selectedId === table.id,
              onGrab: (event) => {
                editing.onSelect(table.id)
                grab(event, table, moveGrip(event, table))
              },
              onGrabCorner: (event, corner) => grab(event, table, { kind: 'resize', corner }),
              onDrag: (event) => drag(event, table),
              onDrop: () => drop(table),
              onCancel: () => setGesture(null),
              onNudge: (event) => nudge(event, table),
              onKeyboardFocus: () => camera.reveal(tablePlacement(table)),
              refusalKey: editing.refusal?.tableId === table.id ? editing.refusal.key : null,
              onRefusalShown: editing.onRefusalShown,
            }}
          />
        )
      }}
    />
  )
}

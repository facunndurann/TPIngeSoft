import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { FLOOR_CELL, covers, tablePlacement, type Placed } from '@restaurant-platform/shared'
import { Minus, Plus } from 'lucide-react'
import { Button, IconButton, floorTile } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { ZOOM, type Camera, type Point } from './camera'
import { FloorTableTile } from './FloorTableTile'
import { changesTo, fitsAt, followPointer, grownToward, nudged, type Grip, type Refusal, type Step } from './placement'
import { cardClass } from './styles'
import type { FloorCamera } from './useFloorCamera'

/**
 * Una mesa agarrada: de dónde, dónde quedaría si se la suelta ahora, si ahí entra
 * y si llegó a moverse (soltarla sin moverla es un toque, no un arrastre).
 */
type Gesture = { tableId: string; grip: Grip; placed: Placed; valid: boolean; moved: boolean }

/** Lo que el plano necesita para editar. Sin esto es de solo lectura. */
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
  /** Sin `editing`, el plano es de solo lectura: las mesas no son botones ni se eligen. */
  editing?: FloorEditing
  /**
   * En la vista: tocar una mesa sin arrastrar el plano la abre (en el Salón, su
   * QR). Editando no llega: el apretón sobre una mesa es para moverla.
   */
  onOpenTable?: (table: FloorTable) => void
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
 * Cómo se desliza la cámara cuando la mueve un botón o el encuadre: lo bastante
 * para no perder dónde se estaba, sin hacer esperar. Con «menos movimiento» en el
 * sistema, `motion-safe` no aplica y salta. La capa de las mesas y el damero usan
 * la misma duración y curva: como el navegador interpola por separado el
 * corrimiento y la escala, lo que estaba bajo el punto del zoom queda quieto
 * durante todo el deslizamiento, y el piso no se despega de las mesas.
 */
const GLIDE = 'motion-safe:duration-200 motion-safe:ease-out'

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
export function FloorCanvas({ tables, camera, editing, onOpenTable, toolbar, footerStart }: FloorCanvasProps) {
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
  function drop(table: FloorTable, onPlace: FloorEditing['onPlace']) {
    if (gesture?.tableId !== table.id) return
    const { grip, placed, moved } = gesture
    // Tocar una manija sin arrastrarla estira la mesa una celda hacia esa esquina:
    // agrandarla no exige arrastrar (WCAG 2.5.7).
    onPlace(table, grip.kind === 'resize' && !moved ? grownToward(tablePlacement(table), grip.corner) : placed)
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
    const next = nudged(tablePlacement(table), step, event.shiftKey ? 'stretch' : 'move')
    onPlace(table, next)
    // La mesa sigue con el foco: que no se vaya de la vista (WCAG 2.4.11).
    camera.reveal(next)
  }

  /**
   * Un toque que no movió el plano. Editando solo llega desde el piso vacío (el
   * apretón sobre una mesa es de la mesa) y suelta la elegida; en la vista, las
   * mesas lo dejan pasar, y la que estaba debajo se abre.
   */
  function tapAt(cell: Point) {
    if (editing) {
      editing.onSelect(null)
      return
    }
    const table = tables.find((entry) => covers(tablePlacement(entry), cell))
    if (table) onOpenTable?.(table)
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
        } ${camera.glide ? `motion-safe:transition-[background-position,background-size] ${GLIDE}` : ''}`}
        style={checker(camera)}
        onPointerDownCapture={camera.grabWithSpace}
        onPointerDown={camera.grab}
        onPointerMove={camera.drag}
        onPointerUp={(event) => {
          if (camera.release(event)) tapAt(camera.cellFromPointer(event))
        }}
        onPointerCancel={camera.release}
      >
        {/* Las mesas van en sus coordenadas del plano (`floorTile` sin origen), aunque
            sean negativas: es la cámara la que corre y escala esta capa. */}
        <div
          className={`absolute top-0 left-0 ${camera.glide ? `motion-safe:transition-transform ${GLIDE}` : ''}`}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, transformOrigin: '0 0' }}
        >
          {tables.map((table) => {
            const active = gesture?.tableId === table.id
            return (
              <FloorTableTile
                key={table.id}
                table={table}
                tile={floorTile(table, placementOf(table))}
                zoom={camera.zoom}
                active={active}
                invalid={active && !gesture.valid}
                openable={onOpenTable !== undefined}
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
                    onKeyboardFocus: () => camera.reveal(tablePlacement(table)),
                    refusalKey: editing.refusal?.tableId === table.id ? editing.refusal.key : null,
                    onRefusalShown: editing.onRefusalShown,
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

/** Un zoom en porcentaje entero, como se lee y como lo maneja el control deslizante. */
const percent = (zoom: number) => Math.round(zoom * 100)

/**
 * El zoom, como un control de volumen: se arrastra la perilla o se toca la barra,
 * y el plano acerca o aleja al instante desde el medio del recuadro. Con el
 * teclado, la barra es un control deslizante nativo: las flechas la mueven de a
 * 1 %, Re Pág y Av Pág de a 12 %, e Inicio y Fin la llevan a los extremos. − y +
 * a los costados dan pasos de 10 % que se deslizan, y «Ajustar al salón» vuelve
 * a encuadrar todas las mesas.
 */
function ZoomControls({ camera }: { camera: FloorCamera }) {
  const zoom = percent(camera.zoom)

  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Zoom del plano">
      {/* Un solo control con sus dos extremos: el contorno es el del grupo, y el
          foco del teclado en la barra lo marca entero. */}
      <div className="flex items-center rounded-full bg-white ring-1 ring-neutral-200 ring-inset has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary">
        <IconButton
          label="Alejar"
          size="touch"
          shape="pill"
          disabled={camera.zoom <= ZOOM.min}
          onClick={() => camera.zoomBy(-ZOOM.step)}
        >
          <Minus size={18} aria-hidden="true" />
        </IconButton>
        <input
          type="range"
          aria-label="Zoom"
          min={percent(ZOOM.min)}
          max={percent(ZOOM.max)}
          step={1}
          value={zoom}
          aria-valuetext={`${zoom} %`}
          onChange={(event) => camera.zoomTo(Number(event.target.value) / 100)}
          // La caja entera es lo que se toca (44 px de alto), aunque la barra se vea fina.
          className="h-11 w-36 cursor-pointer accent-primary focus-visible:outline-none"
        />
        <IconButton
          label="Acercar"
          size="touch"
          shape="pill"
          disabled={camera.zoom >= ZOOM.max}
          onClick={() => camera.zoomBy(ZOOM.step)}
        >
          <Plus size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {/* Lo mismo que anuncia la barra (`aria-valuetext`): para los ojos, no para leerlo dos veces. */}
      <span aria-hidden="true" className="min-w-12 text-sm font-semibold text-neutral-900 tabular-nums">
        {zoom} %
      </span>
      <Button type="button" variant="secondary" size="touch" shape="pill" onClick={camera.fit}>
        Ajustar al salón
      </Button>
    </div>
  )
}

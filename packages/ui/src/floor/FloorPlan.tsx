import { Fragment, type ReactNode } from 'react'
import { FLOOR_CELL, tableAt, tablePlacement, type GridTable } from '@restaurant-platform/shared'
import { Minus, Plus } from 'lucide-react'
import { Button, IconButton } from '../components'
import { ZOOM, type Camera } from './camera'
import type { TableEvents } from './TableButton'
import type { FloorCamera } from './useFloorCamera'

/**
 * Tarjeta del Salón: el plano y los paneles que lo acompañan. Más redondeada que
 * las del resto del panel, como los botones de la pantalla (`shape="pill"`).
 */
export const floorCardClass = 'rounded-2xl border border-neutral-200 bg-white'

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

/** Lo que el plano necesita de una mesa: dónde está, cuánto ocupa y quién es. */
type PlanTable = GridTable & { id: string }

type FloorPlanProps<T extends PlanTable> = {
  /** Qué parte del plano se ve y cómo se recorre. Es de quien dibuja el plano (ver `useFloorCamera`). */
  camera: FloorCamera
  /** Las mesas del sector: el plano las dibuja y sabe cuál se tocó. */
  tables: readonly T[]
  /**
   * Cómo se ve cada mesa, en coordenadas del plano (`floorTile`) aunque sean
   * negativas: la cámara corre y escala la capa que las lleva. `events` es lo que
   * la maneja sin un puntero; una mesa que se toca se lo pasa a `TableButton`.
   */
  renderTable: (table: T, events: TableEvents) => ReactNode
  /** Lo que se lee en el medio del recuadro si el sector no tiene mesas. */
  emptyMessage: string
  /**
   * Un toque en el plano que no lo movió: la mesa que estaba debajo, o `null` si
   * cayó en el piso vacío. Solo llegan los apretones que una mesa deja pasar: en
   * el editor, las mesas se quedan con los suyos para moverlas. Enter sobre una
   * mesa que se toca (`TableButton`) también llega acá, como un toque más.
   */
  onTap: (table: T | null) => void
  /** Barra de arriba de la tarjeta: el estado del sector y, editando, sus acciones. */
  toolbar?: ReactNode
  /** Lo que va a la izquierda del zoom, abajo, como deshacer y rehacer. */
  footerStart?: ReactNode
}

/**
 * El plano de un sector dentro de su tarjeta: el mismo en el editor y en la vista
 * del admin, y en el POS. El recuadro es una ventana a un plano sin bordes: no hay
 * scroll ni barras, la cámara corre el contenido y el damero. Abajo, el zoom.
 */
export function FloorPlan<T extends PlanTable>({
  camera,
  tables,
  renderTable,
  emptyMessage,
  onTap,
  toolbar,
  footerStart,
}: FloorPlanProps<T>) {
  /**
   * Lo que maneja una mesa sin un puntero. Con el mouse o el dedo, el toque lo
   * resuelve el piso (`onPointerUp`): mientras se lo arrastra, el puntero es suyo,
   * y el clic de un mouse ni llega a la mesa. El de un dedo sí llega, porque lo
   * dispara el toque mismo: por eso la mesa atiende solo el clic que no trae un
   * puntero (`detail` 0), el del teclado o un lector de pantalla, y no cuenta dos
   * veces el del dedo. El foco del teclado la trae a la vista (WCAG 2.4.11); con
   * el mouse o el dedo ya se ve, se la acaba de tocar.
   */
  const eventsOf = (table: T): TableEvents => ({
    onClick: (event) => {
      if (event.detail === 0) onTap(table)
    },
    onFocus: (event) => {
      if (event.currentTarget.matches(':focus-visible')) camera.reveal(tablePlacement(table))
    },
  })

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${floorCardClass}`}>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2.5">
          {toolbar}
        </div>
      )}

      {/* Los gestos táctiles son todos del plano (`touch-none`): un dedo lo
          arrastra y dos lo pellizcan. Al piso solo llegan los apretones que no
          agarró una mesa. */}
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
          if (camera.release(event)) onTap(tableAt(tables, camera.cellFromPointer(event)) ?? null)
        }}
        onPointerCancel={camera.release}
      >
        <div
          className={`absolute top-0 left-0 ${camera.glide ? `motion-safe:transition-transform ${GLIDE}` : ''}`}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, transformOrigin: '0 0' }}
        >
          {tables.map((table) => (
            <Fragment key={table.id}>{renderTable(table, eventsOf(table))}</Fragment>
          ))}
        </div>
        {tables.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            {emptyMessage}
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

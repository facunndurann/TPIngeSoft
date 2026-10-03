import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Users, X } from 'lucide-react'
import type { FloorTile } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { CHAIR_SIZE, chairsAround } from './chairs'
import type { Corner } from './placement'
import { labelLayout } from './tableLabel'

type PointerHandler = (event: ReactPointerEvent<HTMLElement>) => void

/** Lo que hace una mesa mientras se edita el plano. */
export type TileEditing = {
  selected: boolean
  /** Apretar la mesa: para moverla. */
  onGrab: PointerHandler
  /** Apretar una de sus manijas: para estirarla desde esa esquina. */
  onGrabCorner: (event: ReactPointerEvent<HTMLElement>, corner: Corner) => void
  onDrag: PointerHandler
  onDrop: () => void
  onCancel: () => void
  /** Las flechas: moverla o, con Mayús, estirarla. */
  onNudge: (event: KeyboardEvent<HTMLElement>) => void
  /** Le llegó el foco con el teclado: el plano la trae a la vista. */
  onKeyboardFocus: () => void
  /**
   * Cambia cada vez que la mesa no entró donde se la quiso llevar; `null` si no
   * hay nada que marcar en ella. Cuando la marca terminó de verse, `onRefusalShown`.
   */
  refusalKey: number | null
  onRefusalShown: () => void
}

type FloorTableTileProps = {
  table: FloorTable
  tile: FloorTile
  /** El zoom de la cámara: el texto y las manijas lo compensan para no achicarse en pantalla. */
  zoom: number
  /** La del gesto en curso: va arriba de las demás. */
  active: boolean
  /** Donde la lleva el gesto pisaría a otra: se marca con una ✕, además del rojo. */
  invalid: boolean
  /** Sin esto, la mesa es de solo lectura: no es un botón ni tiene manijas. */
  editing?: TileEditing
}

const CORNERS: readonly (Corner & { cursor: string })[] = [
  { dx: -1, dy: -1, cursor: 'cursor-nw-resize' },
  { dx: 1, dy: -1, cursor: 'cursor-ne-resize' },
  { dx: -1, dy: 1, cursor: 'cursor-sw-resize' },
  { dx: 1, dy: 1, cursor: 'cursor-se-resize' },
]

/** Lo mínimo que se puede tocar con el puntero, en píxeles de pantalla (WCAG 2.5.8). */
const MIN_TARGET = 24

/** El cuadradito que se ve en cada esquina, en píxeles del plano (`h-3.5`). */
const HANDLE_SIZE = 14

/** La ✕ de «no entra», en píxeles de pantalla. */
const NO_FIT_ICON = 24

/** Lo que se corre la marca de «no entra» hacia cada lado al sacudirse, en píxeles de pantalla. */
const NO_FIT_SHAKE = 6

const tableBaseClass =
  'absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center transition-colors'

/**
 * Una mesa del plano con sus sillas: mientras se edita, un botón que se arrastra,
 * se estira desde sus manijas y se mueve con las flechas; en la vista, un dibujo
 * de solo lectura.
 */
export function FloorTableTile({ table, tile, zoom, active, invalid, editing }: FloorTableTileProps) {
  const selected = editing?.selected ?? false
  const muted = !table.is_active || !table.is_visible
  const look = tableLook({ invalid, selected, muted })
  // El área que se toca de cada manija: nunca menos de 24 px en pantalla, haya el zoom que haya.
  const handleHit = Math.max(HANDLE_SIZE, MIN_TARGET / zoom)

  return (
    <>
      {chairsAround(tile.box, table.shape === 'round', table.seats).map((chair, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`absolute rounded-full ${look.chair}`}
          style={{ ...chair, width: CHAIR_SIZE, height: CHAIR_SIZE, zIndex: active ? 9 : 0 }}
        />
      ))}

      {editing ? (
        <>
          <button
            type="button"
            aria-pressed={selected}
            onPointerDown={editing.onGrab}
            onPointerMove={editing.onDrag}
            onPointerUp={editing.onDrop}
            onPointerCancel={editing.onCancel}
            onKeyDown={editing.onNudge}
            onFocus={(event) => {
              // Con el teclado, la mesa que recibe el foco se trae a la vista (WCAG
              // 2.4.11); con el mouse o el dedo ya se ve: se la acaba de tocar.
              if (event.currentTarget.matches(':focus-visible')) editing.onKeyboardFocus()
            }}
            // Editando, el toque que empieza sobre una mesa es para arrastrarla
            // (`touch-none`); el que empieza en el piso vacío desplaza el plano.
            className={`${tableBaseClass} cursor-grab touch-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing ${tile.shapeClass} ${look.table}`}
            style={{ ...tile.box, zIndex: active ? 10 : 1 }}
            aria-label={`${table.label}, ${table.seats} lugares${muted ? ', fuera de uso' : ''}. Flechas para mover, Mayús y flechas para cambiar el tamaño, Suprimir para eliminar.`}
          >
            <TableLabel table={table} tile={tile} zoom={zoom} muted={muted} />
          </button>

          {/* Manijas de tamaño: solo en la mesa elegida, para no ensuciar el plano.
              Son un atajo para el mouse y el dedo, sin rol ni foco: con teclado se
              estira con Mayús y las flechas, y con un toque, desde el panel. El área
              que se toca va de la esquina hacia afuera, para no tapar la mesa; el
              cuadradito que se ve queda pegado a la esquina. */}
          {selected &&
            CORNERS.map((corner) => (
              <span
                key={corner.cursor}
                aria-hidden="true"
                className={`absolute flex touch-none ${corner.dx > 0 ? 'justify-start' : 'justify-end'} ${
                  corner.dy > 0 ? 'items-start' : 'items-end'
                } ${corner.cursor}`}
                onPointerDown={(event) => editing.onGrabCorner(event, corner)}
                onPointerMove={editing.onDrag}
                onPointerUp={editing.onDrop}
                onPointerCancel={editing.onCancel}
                style={{
                  left: corner.dx > 0 ? tile.box.left + tile.box.width : tile.box.left - handleHit,
                  top: corner.dy > 0 ? tile.box.top + tile.box.height : tile.box.top - handleHit,
                  width: handleHit,
                  height: handleHit,
                  zIndex: active ? 11 : 2,
                }}
              >
                <span className="h-3.5 w-3.5 rounded-sm border-2 border-primary bg-white" />
              </span>
            ))}

          {/* «Ahí no entra», sobre la propia mesa y no solo con color: quieta mientras
              el gesto la lleva a un lugar ocupado, y un instante cuando se la quiso
              dejar en uno. Cada rechazo es una marca nueva (`key`). */}
          {invalid && <NoFitMark tile={tile} zoom={zoom} />}
          {editing.refusalKey !== null && (
            <NoFitMark key={editing.refusalKey} tile={tile} zoom={zoom} onShown={editing.onRefusalShown} />
          )}
        </>
      ) : (
        <div className={`${tableBaseClass} ${tile.shapeClass} ${look.table}`} style={{ ...tile.box, zIndex: 1 }}>
          <TableLabel table={table} tile={tile} zoom={zoom} muted={muted} />
        </div>
      )}
    </>
  )
}

/** Colores de una mesa y sus sillas según su estado. El gesto rechazado le gana a todo. */
function tableLook({ invalid, selected, muted }: { invalid: boolean; selected: boolean; muted: boolean }) {
  const selection = selected ? 'outline-3 outline-offset-4 outline-primary' : ''
  if (invalid) return { table: `border-red-500 bg-red-50 text-red-700 ${selection}`, chair: 'bg-red-300' }
  if (muted)
    return {
      table: `border-dashed border-neutral-300 bg-neutral-50 text-faint ${selection}`,
      chair: selected ? 'bg-primary' : 'bg-neutral-200',
    }
  return {
    table: `border-neutral-300 bg-white text-neutral-900 hover:border-primary/70 ${selection}`,
    chair: selected ? 'bg-primary' : 'bg-neutral-400',
  }
}

/**
 * «Ahí no entra»: un borde punteado rojo con una ✕ que tapa la mesa, para que no
 * dependa solo del color. Sin `onShown` queda quieta; con `onShown` aparece, se
 * sacude (salvo con «menos movimiento») y se va, y avisa al terminar (ver
 * `refuse` en index.css). Es solo para la vista: el aviso de arriba explica por
 * qué y es el que anuncian los lectores de pantalla.
 */
function NoFitMark({ tile, zoom, onShown }: { tile: FloorTile; zoom: number; onShown?: () => void }) {
  // Como el texto y las manijas, la ✕ y el sacudón compensan el zoom para medir
  // lo mismo en pantalla; la ✕ nunca se sale de la mesa.
  const icon = Math.min(NO_FIT_ICON / zoom, tile.box.width - 8, tile.box.height - 8)
  // Va arriba de la mesa y de sus manijas, aun mientras se la arrastra. React no
  // tipa las variables de CSS: de ahí el `as`.
  const style = { ...tile.box, zIndex: 12, '--refuse-shake': `${NO_FIT_SHAKE / zoom}px` } as CSSProperties
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute flex items-center justify-center border-2 border-dashed border-red-600 bg-red-50 text-red-700 ${tile.shapeClass} ${
        onShown ? 'motion-safe:animate-refuse motion-reduce:animate-refuse-still' : ''
      }`}
      style={style}
      onAnimationEnd={onShown}
    >
      <X size={icon} strokeWidth={2.5} />
    </span>
  )
}

function TableLabel({ table, tile, zoom, muted }: { table: FloorTable; tile: FloorTile; zoom: number; muted: boolean }) {
  const detail = muted ? 'fuera de uso' : `${table.seats} lugares`
  const layout = labelLayout(tile.box, zoom, {
    name: table.label,
    detail,
    compact: muted ? null : String(table.seats),
  })
  const detailStyle = { fontSize: layout.detailSize }
  const name = (
    <span
      className={`max-w-full min-w-0 px-1 leading-tight font-bold ${
        layout.nameLines === 2 ? 'line-clamp-2 break-words' : 'truncate'
      }`}
      style={{ fontSize: layout.nameSize }}
    >
      {table.label}
    </span>
  )

  switch (layout.detail) {
    case 'below':
      return (
        <>
          {name}
          <span className="leading-tight" style={detailStyle}>
            {detail}
          </span>
        </>
      )
    case 'beside':
      return (
        <span className="flex max-w-full items-baseline gap-2">
          {name}
          <span className="shrink-0 leading-tight" style={detailStyle}>
            {detail}
          </span>
        </span>
      )
    case 'compact':
      return (
        <>
          {name}
          <span className="inline-flex items-center gap-0.5 leading-tight" style={detailStyle}>
            <Users size={layout.detailSize} aria-hidden="true" />
            {table.seats}
          </span>
        </>
      )
    case 'none':
      return name
  }
}

/**
 * Qué significa cada marca del plano. Vive junto a `tableLook` porque usa sus
 * mismos colores. «Seleccionada» solo existe editando.
 */
export function FloorLegend({ editing }: { editing: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-neutral-400" />
        Cada silla es un lugar
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-5.5 rounded border-2 border-dashed border-neutral-300 bg-neutral-50" />
        Fuera de uso
      </li>
      {editing && (
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5.5 rounded border-2 border-primary bg-white" />
          Seleccionada
        </li>
      )}
    </ul>
  )
}

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Users } from 'lucide-react'
import type { FloorTile } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { CHAIR_SIZE, chairsAround } from './chairs'
import type { Corner } from './placement'

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
}

type FloorTableTileProps = {
  table: FloorTable
  tile: FloorTile
  /** La del gesto en curso: va arriba de las demás. */
  active: boolean
  /** Donde la lleva el gesto pisaría a otra: se pinta de rojo. */
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

/** Del borde de la mesa al centro de su manija: sobre el contorno de la selección. */
const HANDLE_REACH = 7

const tableBaseClass =
  'absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center transition-colors'

/**
 * Una mesa del plano con sus sillas: mientras se edita, un botón que se arrastra,
 * se estira desde sus manijas y se mueve con las flechas; en la vista, un dibujo
 * de solo lectura.
 */
export function FloorTableTile({ table, tile, active, invalid, editing }: FloorTableTileProps) {
  const selected = editing?.selected ?? false
  const muted = !table.is_active || !table.is_visible
  const look = tableLook({ invalid, selected, muted })

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
            // Editando, el toque que empieza sobre una mesa es para arrastrarla
            // (`touch-none`); el que empieza en el piso vacío desplaza el plano.
            className={`${tableBaseClass} cursor-grab touch-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing ${tile.shapeClass} ${look.table}`}
            style={{ ...tile.box, zIndex: active ? 10 : 1 }}
            aria-label={`${table.label}, ${table.seats} lugares${muted ? ', fuera de uso' : ''}. Flechas para mover, Mayús y flechas para cambiar el tamaño, Suprimir para eliminar.`}
          >
            <TableLabel table={table} tile={tile} muted={muted} />
          </button>

          {/* Manijas de tamaño: solo en la mesa elegida, para no ensuciar el plano.
              Son un atajo para el mouse y el dedo, sin rol ni foco: el tamaño con
              teclado se cambia con Mayús y las flechas. */}
          {selected &&
            CORNERS.map((corner) => (
              <span
                key={corner.cursor}
                aria-hidden="true"
                className={`absolute h-3.5 w-3.5 touch-none rounded-sm border-2 border-primary bg-white ${corner.cursor}`}
                onPointerDown={(event) => editing.onGrabCorner(event, corner)}
                onPointerMove={editing.onDrag}
                onPointerUp={editing.onDrop}
                onPointerCancel={editing.onCancel}
                style={{
                  left: tile.box.left + (corner.dx > 0 ? tile.box.width : 0) + corner.dx * HANDLE_REACH - 7,
                  top: tile.box.top + (corner.dy > 0 ? tile.box.height : 0) + corner.dy * HANDLE_REACH - 7,
                  zIndex: active ? 11 : 2,
                }}
              />
            ))}
        </>
      ) : (
        <div className={`${tableBaseClass} ${tile.shapeClass} ${look.table}`} style={{ ...tile.box, zIndex: 1 }}>
          <TableLabel table={table} tile={tile} muted={muted} />
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
 * Nombre y lugares de la mesa, como entren: en dos renglones si hay lugar, en
 * uno si es baja y larga (una barra), y los lugares con ícono en la de una celda,
 * donde «12 lugares» no entra. Fuera de uso, el estado reemplaza a los lugares.
 */
function TableLabel({ table, tile, muted }: { table: FloorTable; tile: FloorTile; muted: boolean }) {
  const { w, h } = tile.footprint
  const detail = muted ? 'fuera de uso' : `${table.seats} lugares`
  const name = <span className="px-1 text-sm leading-tight font-bold">{table.label}</span>

  if (w >= 2 && h >= 2)
    return (
      <>
        {name}
        <span className="text-xs leading-tight">{detail}</span>
      </>
    )
  if (w >= 3)
    return (
      <span className="flex items-baseline gap-2">
        {name}
        <span className="text-xs leading-tight">{detail}</span>
      </span>
    )
  return (
    <>
      {name}
      {!muted && (
        <span className="inline-flex items-center gap-0.5 text-xs leading-tight">
          <Users size={12} aria-hidden="true" />
          {table.seats}
        </span>
      )}
    </>
  )
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

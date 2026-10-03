import { useRef, useState, type ReactNode } from 'react'
import {
  countLabel,
  formatElapsed,
  posTableStateLabels,
  posTableStates,
  tablePlacement,
} from '@restaurant-platform/shared'
import { Users } from 'lucide-react'
import {
  ChairsLegendItem,
  FloorPlan,
  TableButton,
  TableChairs,
  floorTile,
  useFloorCamera,
  useNow,
  type FloorTile,
  type TableEvents,
} from '@restaurant-platform/ui'
import { visibleTotal, type FloorMapEntry } from './floorEntry'
import { posTableLabel } from './posTableLabel'
import type { PosFloorSection } from './queries'
import { tableStateStyles } from './status-colors'
import { useDoubleTap } from './useDoubleTap'

/**
 * El plano de un sector en el POS: el mismo del admin (`FloorPlan`), con cada
 * mesa pintada según su estado. Tocar una mesa la elige y muestra su resumen;
 * dos toques seguidos sobre la misma abren su comanda, y tocar el piso vacío la
 * suelta.
 */
export function FloorSurface({
  section,
  entries,
  onOpenTable,
  renderSummary,
}: {
  section: PosFloorSection
  entries: FloorMapEntry[]
  onOpenTable: (tableId: string) => void
  /** El resumen de la mesa elegida: lo que dice y qué se puede hacer. `close` lo cierra. */
  renderSummary: (entry: FloorMapEntry, close: () => void) => ReactNode
}) {
  // Las mesas muestran cuánto hace que se abrieron: el plano es lo que el reloj
  // tiene que redibujar, no la pantalla con sus pestañas y su leyenda.
  const now = useNow()
  const camera = useFloorCamera(entries)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = entries.find((entry) => entry.id === selectedId)
  const planRef = useRef<HTMLElement>(null)
  const isSecondTap = useDoubleTap()
  const occupied = entries.filter((entry) => entry.state !== 'free').length

  function closeSummary() {
    // El botón que cerró el resumen desaparece con él: el foco vuelve a la mesa
    // en lugar de caer al <body>.
    planRef.current?.querySelector<HTMLElement>(`[data-table-id="${selectedId}"]`)?.focus()
    setSelectedId(null)
  }

  /**
   * Un toque que no movió el plano, con el mouse, el dedo o Enter: sobre una mesa
   * la elige, y si es el segundo seguido sobre la misma, abre su comanda; en el
   * piso vacío (`null`), suelta la elegida.
   */
  function tapOn(entry: FloorMapEntry | null) {
    const second = isSecondTap(entry?.id ?? null)
    if (entry && second) onOpenTable(entry.id)
    else setSelectedId(entry?.id ?? null)
  }

  return (
    <div className="min-w-0 space-y-3">
      {/* El plano y su leyenda llegan al pie de la pantalla, como en el admin: se
          ven enteros sin desplazar la página, y el zoom queda a mano. */}
      <section
        ref={planRef}
        aria-labelledby="floor-map-heading"
        className="flex h-[calc(100dvh-20rem)] min-h-96 min-w-0 flex-col gap-3"
      >
        <FloorPlan
          camera={camera}
          tables={entries}
          emptyMessage="Este sector todavía no tiene mesas operativas."
          onTap={tapOn}
          toolbar={
            <div className="px-1">
              <h2 id="floor-map-heading" className="text-sm font-semibold text-neutral-800">
                {section.name}
              </h2>
              <p className="text-xs text-muted">
                {countLabel(entries.length, 'mesa operativa', 'mesas operativas')} · {countLabel(occupied, 'ocupada')}
              </p>
            </div>
          }
          renderTable={(entry, events) => (
            <FloorTable
              entry={entry}
              tile={floorTile(entry, tablePlacement(entry))}
              zoom={camera.zoom}
              now={now}
              selected={entry.id === selectedId}
              events={events}
            />
          )}
        />
        <StateLegend />
      </section>

      {/* El resumen va después del plano y no antes: al aparecer no empuja las mesas,
          así la mesa tocada queda bajo el dedo y el segundo toque cae en la misma.
          Se pega abajo (sticky) y flota sobre el pie del plano; al bajar la página
          vuelve a su lugar, sin tapar nada. */}
      {selected && <div className="sticky bottom-4 z-10">{renderSummary(selected, closeSummary)}</div>}
    </div>
  )
}

/**
 * Qué significa cada marca del plano, debajo de él como en el admin: las sillas
 * y el color de cada estado. Cada estado se muestra como una mesa chica, con el
 * borde y el fondo de su color: un punto gris se confundiría con una silla.
 */
function StateLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <ChairsLegendItem />
      {posTableStates.map((state) => (
        <li key={state} className="flex items-center gap-2">
          <span aria-hidden="true" className={`h-3 w-5.5 rounded border-2 ${tableStateStyles[state].tile}`} />
          {posTableStateLabels[state]}
        </li>
      ))}
    </ul>
  )
}

/**
 * Una mesa del plano del POS: sus sillas y un botón con el color de su estado
 * (`TableButton`, el mismo de la vista del admin). Muestra lo que entra en 12 px
 * a contraste pleno (`posTableLabel`); el total y el responsable siguen en el
 * nombre accesible y en el resumen que abre el toque.
 */
function FloorTable({
  entry,
  tile,
  zoom,
  now,
  selected,
  events,
}: {
  entry: FloorMapEntry
  tile: FloorTile
  zoom: number
  /** La hora del reloj compartido (`useNow`), para el tiempo de la mesa. */
  now: number
  selected: boolean
  events: TableEvents
}) {
  const { session, state } = entry
  const operator = session?.assigned_employee_name ?? 'Sin asignar'
  const total = visibleTotal(session)
  const elapsed = session && formatElapsed(session.opened_at, now, 'exact')
  const summary = session ? `${elapsed}${total === null ? '' : `, ${total}`}, ${operator}` : `${entry.seats} lugares`
  const label = posTableLabel(tile.box, zoom)
  const text = { fontSize: label.size }

  return (
    <>
      <TableChairs tile={tile} round={entry.shape === 'round'} seats={entry.seats} />
      <TableButton
        tile={tile}
        events={events}
        data-table-id={entry.id}
        aria-pressed={selected}
        aria-label={`${entry.label}, ${posTableStateLabels[state]}, ${summary}`}
        className={`shadow-sm transition hover:brightness-95 ${tableStateStyles[state].tile} ${
          selected ? 'outline-3 outline-offset-4 outline-primary' : ''
        }`}
      >
        {/* Con lugar, el nombre usa dos renglones antes de cortarse. Cortado, el
            title lo muestra entero con el mouse, y el resumen, al tocarla. */}
        <span
          title={entry.label}
          className={`max-w-full px-1 leading-tight font-bold ${
            label.nameLines === 2 ? 'line-clamp-2 break-words' : 'truncate'
          }`}
          style={text}
        >
          {entry.label}
        </span>
        {label.state && (
          <span
            className={`mt-0.5 max-w-[90%] truncate rounded px-1 py-0.5 leading-none font-semibold ${tableStateStyles[state].tileLabel}`}
            style={text}
          >
            {posTableStateLabels[state]}
          </span>
        )}
        {label.last &&
          (session ? (
            <span className="mt-1 max-w-[90%] truncate leading-none font-medium" style={text}>
              {elapsed}
            </span>
          ) : (
            <span className="mt-1 inline-flex items-center gap-1 leading-none" style={text}>
              <Users size={label.size} aria-hidden="true" />
              {entry.seats}
            </span>
          ))}
      </TableButton>
    </>
  )
}

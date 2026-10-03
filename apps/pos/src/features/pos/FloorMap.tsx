import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  countLabel,
  formatElapsed,
  formatPrice,
  getPosTableState,
  posTableStateLabels,
  posTableStates,
  tablePlacement,
  type PosTableState,
} from '@restaurant-platform/shared'
import { ClipboardList, Clock3, Move, UserRound, Users, X } from 'lucide-react'
import {
  Button,
  ChairsLegendItem,
  Elapsed,
  FloorPlan,
  IconButton,
  QueryView,
  SectionPills,
  SummaryItem,
  TableChairs,
  floorTile,
  useFloorCamera,
  useNow,
  type FloorTile,
} from '@restaurant-platform/ui'
import { useCan, usePosScope } from '@/context/pos-context'
import { MoveTableSession } from './MoveTableSession'
import { posTableLabel } from './posTableLabel'
import {
  posFloorSectionsQuery,
  posOpenSessionsQuery,
  posTablesQuery,
  type PosDiningTable,
  type PosFloorSection,
  type PosOpenSession,
} from './queries'
import { AttendRequestButtons, SessionRequestBadges } from './ServiceRequests'
import { tableStateStyles } from './status-colors'
import { TableStateBadge } from './StatusBadges'

/**
 * Plano operativo del salón (MI-62/MI-63/MI-64): el mismo plano del admin, con
 * su cámara, sus sillas y su zoom. El layout viene de la configuración
 * administrativa y el estado de pedidos/cuenta se compone desde la sesión
 * abierta. Tocar una mesa muestra su resumen, y desde ahí (o con dos toques
 * seguidos) se abre su comanda (MI-64).
 */
export function FloorMap() {
  const scope = usePosScope()
  const sections = useQuery(posFloorSectionsQuery(scope))
  const tables = useQuery(posTablesQuery(scope))
  const sessions = useQuery(posOpenSessionsQuery(scope))

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Salón</h1>
        <p className="text-sm text-muted">
          Plano operativo de las mesas disponibles, organizado por sector.
        </p>
      </div>

      <QueryView
        query={[sections, tables, sessions]}
        fallback="No pudimos cargar el plano del salón."
        empty="Todavía no hay sectores activos configurados para operar."
        isEmpty={([sections]) => sections.length === 0}
      >
        {([sections, tables, sessions]) => (
          <FloorSections sections={sections} tables={tables} sessions={sessions} />
        )}
      </QueryView>
    </div>
  )
}

/**
 * Los sectores del salón ya cargados. El sector vive en la query, no en estado
 * local: así volver desde la comanda deja el plano en el mismo sector, y
 * recargar o compartir el link también.
 */
function FloorSections({
  sections,
  tables,
  sessions,
}: {
  sections: PosFloorSection[]
  tables: PosDiningTable[]
  sessions: PosOpenSession[]
}) {
  const [moving, setMoving] = useState<FloorMapEntry | null>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionChoice = searchParams.get('sector')

  const chooseSection = (id: string) => setSearchParams({ sector: id }, { replace: true })

  const activeSection = sections.find((section) => section.id === sectionChoice) ?? sections[0]
  const sessionByTable = useMemo(
    () => new Map(sessions.map((session) => [session.table_id, session])),
    [sessions],
  )
  const entries = tables
    .filter((table) => table.section_id === activeSection.id)
    .map((table): FloorMapEntry => {
      const session = sessionByTable.get(table.id)
      return { ...table, session, state: getPosTableState(session) }
    })

  return (
    <>
      {moving?.session && (
        <MoveTableSession source={moving} sessionId={moving.session.id}
          onClose={() => setMoving(null)} />
      )}

      <SectionPills
        label="Sectores del salón"
        sections={sections.map((section) => ({
          id: section.id,
          name: section.name,
          tables: tables.filter((table) => table.section_id === section.id).length,
          inUse: section.is_active,
        }))}
        activeId={activeSection.id}
        onChoose={chooseSection}
      />

      {/* Otro sector es otro plano: su cámara se encuadra de cero y el resumen se cierra. */}
      <FloorSurface
        key={activeSection.id}
        section={activeSection}
        entries={entries}
        onMoveTable={setMoving}
        onOpenTable={(tableId) =>
          navigate({
            pathname: `/salon/${tableId}`,
            search: searchParams.toString(),
          })
        }
      />
    </>
  )
}

/**
 * Una mesa del plano con lo que el POS sabe de ella. Tiene la forma de una mesa,
 * así la cámara (`useFloorCamera`) y el toque (`tableAt`) la reciben tal cual, y
 * cada mesa se dibuja con su sesión a mano.
 */
type FloorMapEntry = PosDiningTable & {
  session?: PosOpenSession
  state: PosTableState
}

/**
 * Total de la mesa listo para mostrar, o null si no hay sesión o si quien mira
 * no tiene `payments.read`: la vista trae ese importe en null, y la mesa no
 * muestra un «$ 0» que no es.
 */
function visibleTotal(session: PosOpenSession | undefined): string | null {
  if (!session || session.total_amount === null) return null
  return formatPrice(session.total_amount)
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

/** El tiempo entre dos toques sobre la misma mesa para que abran su comanda, como un doble clic. */
const DOUBLE_TAP_MS = 500

function FloorSurface({
  section,
  entries,
  onOpenTable,
  onMoveTable,
}: {
  section: PosFloorSection
  entries: FloorMapEntry[]
  onOpenTable: (tableId: string) => void
  onMoveTable: (entry: FloorMapEntry) => void
}) {
  // Las mesas muestran cuánto hace que se abrieron: el plano es lo que el reloj
  // tiene que redibujar, no la pantalla con sus pestañas y su leyenda.
  const now = useNow()
  const camera = useFloorCamera(entries)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = entries.find((entry) => entry.id === selectedId)
  const planRef = useRef<HTMLElement>(null)
  /** El último toque sobre una mesa: si el siguiente cae en la misma enseguida, es doble. */
  const lastTap = useRef<{ tableId: string; at: number } | null>(null)
  const occupied = entries.filter((entry) => entry.state !== 'free').length

  function closeSummary() {
    // El botón que cerró el resumen desaparece con él: el foco vuelve a la mesa
    // en lugar de caer al <body>.
    planRef.current?.querySelector<HTMLElement>(`[data-table-id="${selectedId}"]`)?.focus()
    setSelectedId(null)
  }

  /**
   * Un toque del mouse o del dedo que no movió el plano (los del teclado llegan a
   * cada mesa): sobre una mesa muestra su resumen, y dos seguidos sobre la misma
   * abren su comanda; en el piso vacío (`null`), cierra el resumen.
   */
  function tapOn(entry: FloorMapEntry | null) {
    const at = performance.now()
    const previous = lastTap.current
    lastTap.current = entry ? { tableId: entry.id, at } : null
    if (!entry) {
      setSelectedId(null)
    } else if (previous?.tableId === entry.id && at - previous.at < DOUBLE_TAP_MS) {
      lastTap.current = null
      onOpenTable(entry.id)
    } else {
      setSelectedId(entry.id)
    }
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
          renderTable={(entry) => (
            <FloorTable
              entry={entry}
              tile={floorTile(entry, tablePlacement(entry))}
              zoom={camera.zoom}
              now={now}
              selected={entry.id === selectedId}
              onChoose={() => setSelectedId(entry.id)}
              onKeyboardFocus={() => camera.reveal(tablePlacement(entry))}
            />
          )}
        />
        <StateLegend />
      </section>

      {/* El resumen va después del plano y no antes: al aparecer no empuja las mesas,
          así la mesa tocada queda bajo el dedo y el segundo toque cae en la misma.
          Se pega abajo (sticky) y flota sobre el pie del plano; al bajar la página
          vuelve a su lugar, sin tapar nada. */}
      {selected && (
        <div className="sticky bottom-4 z-10">
          <TableSummary entry={selected} onOpen={onOpenTable} onMove={onMoveTable} onClose={closeSummary} />
        </div>
      )}
    </div>
  )
}

/**
 * Una mesa del plano del POS: sus sillas y un botón con el color de su estado.
 * Muestra lo que entra en 12 px a contraste pleno (`posTableLabel`); el total y
 * el responsable siguen en el nombre accesible y en el resumen que abre el toque.
 */
function FloorTable({
  entry,
  tile,
  zoom,
  now,
  selected,
  onChoose,
  onKeyboardFocus,
}: {
  entry: FloorMapEntry
  tile: FloorTile
  zoom: number
  /** La hora del reloj compartido (`useNow`), para el tiempo de la mesa. */
  now: number
  selected: boolean
  onChoose: () => void
  /** Le llegó el foco con el teclado: el plano la trae a la vista. */
  onKeyboardFocus: () => void
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
      <button
        type="button"
        data-table-id={entry.id}
        aria-pressed={selected}
        aria-label={`${entry.label}, ${posTableStateLabels[state]}, ${summary}`}
        // El mouse y el dedo los resuelve el plano (`tapAt`): mientras se lo arrastra,
        // el puntero es suyo, y el clic de un mouse ni llega acá. Este clic es el del
        // teclado o el de un lector de pantalla, que no traen puntero (`detail` 0):
        // el que dispara un dedo al tocar no cuenta dos veces.
        onClick={(event) => {
          if (event.detail === 0) onChoose()
        }}
        onFocus={(event) => {
          // Con el teclado, la mesa que recibe el foco se trae a la vista (WCAG
          // 2.4.11); con el mouse o el dedo ya se ve: se la acaba de tocar.
          if (event.currentTarget.matches(':focus-visible')) onKeyboardFocus()
        }}
        className={`absolute flex cursor-pointer flex-col items-center justify-center overflow-hidden border-2 text-center shadow-sm transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
          tableStateStyles[state].tile
        } ${selected ? 'outline-3 outline-offset-4 outline-primary' : ''} ${tile.shapeClass}`}
        style={{ ...tile.box, zIndex: 1 }}
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
      </button>
    </>
  )
}

function TableSummary({
  entry,
  onOpen,
  onMove,
  onClose,
}: {
  entry: FloorMapEntry
  onOpen: (tableId: string) => void
  onMove: (entry: FloorMapEntry) => void
  /** Flota sobre el plano: tiene que poder cerrarse para ver lo que tapa. */
  onClose: () => void
}) {
  const can = useCan()
  const { session, state } = entry
  const total = visibleTotal(session)

  return (
    <div
      role="region"
      aria-label={`Resumen de ${entry.label}`}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-lg"
    >
      <div className="mr-auto space-y-1">
        <p className="font-semibold text-neutral-900">{entry.label}</p>
        <TableStateBadge state={state} />
        {session && <SessionRequestBadges session={session} />}
      </div>
      {session ? (
        <>
          <SummaryItem icon={Clock3} label="Abierta" value={<Elapsed since={session.opened_at} precision="exact" />} />
          {total !== null && <SummaryItem label="Total acumulado" value={total} />}
          <SummaryItem label="Pedidos activos" value={String(session.kitchen_tickets)} />
          <SummaryItem
            icon={UserRound}
            label="Responsable"
            value={session.assigned_employee_name ?? 'Sin asignar'}
          />
        </>
      ) : (
        <SummaryItem icon={Users} label="Capacidad" value={`${entry.seats} lugares`} />
      )}
      {session && <AttendRequestButtons session={session} />}
      {session && can('sessions.move') && (
        <Button variant="secondary" onClick={() => onMove(entry)}>
          <Move size={15} /> Mover comanda
        </Button>
      )}
      <Button onClick={() => onOpen(entry.id)}>
        <ClipboardList size={15} />
        {session ? 'Continuar comanda' : 'Abrir comanda'}
      </Button>
      <IconButton label={`Cerrar resumen de ${entry.label}`} onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </IconButton>
    </div>
  )
}

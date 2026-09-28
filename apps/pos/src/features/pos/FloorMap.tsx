import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { countLabel, formatElapsed, formatPrice, getPosTableState, type PosTableState, posTableStateLabels, posTableStates } from '@restaurant-platform/shared'
import { ClipboardList, Clock3, Move, UserRound, Users } from 'lucide-react'
import { Button, ChoiceChip, Elapsed, EmptyState, ErrorText, FloorGrid, Spinner, SummaryItem, useNow } from '@restaurant-platform/ui'
import { useCan, useRestaurant } from '@/context/pos-context'
import { MoveTableSession } from './MoveTableSession'
import {
  posFloorSectionsQuery,
  posOpenSessionsQuery,
  posTablesQuery,
  type PosDiningTable,
  type PosOpenSession,
} from './queries'
import { AttendRequestButtons, SessionRequestBadges } from './ServiceRequests'
import { tableStateStyles } from './status-colors'
import { TableStateBadge } from './StatusBadges'

/**
 * Plano operativo del salón (MI-62/MI-63/MI-64). El layout viene de la
 * configuración administrativa y el estado de pedidos/cuenta se compone desde
 * la sesión abierta. Tocar una mesa abre su comanda (MI-64).
 *
 * El sector vive en la query, no en estado local: así volver desde la comanda
 * deja el plano en el mismo sector, y recargar o compartir el link también.
 */
export function FloorMap() {
  const restaurant = useRestaurant()
  const [moving, setMoving] = useState<FloorMapEntry | null>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionChoice = searchParams.get('sector')

  const chooseSection = (id: string) => setSearchParams({ sector: id }, { replace: true })

  const sections = useQuery(posFloorSectionsQuery(restaurant.id, restaurant.branchId))
  const tables = useQuery(posTablesQuery(restaurant.id, restaurant.branchId))
  const sessions = useQuery(posOpenSessionsQuery(restaurant.id, restaurant.branchId))

  const floorSections = sections.data ?? []
  const sectionId = floorSections.some((section) => section.id === sectionChoice)
    ? sectionChoice
    : (floorSections[0]?.id ?? null)
  const sectionTables = (tables.data ?? []).filter((table) => table.section_id === sectionId)
  const activeSection = floorSections.find((section) => section.id === sectionId)

  const sessionByTable = useMemo(
    () => new Map((sessions.data ?? []).map((session) => [session.table_id, session])),
    [sessions.data],
  )
  const entries = sectionTables.map((table): FloorMapEntry => {
    const session = sessionByTable.get(table.id)
    return { ...table, session, state: getPosTableState(session) }
  })
  const occupied = entries.filter((entry) => entry.state !== 'free').length

  if (sections.isLoading || tables.isLoading || sessions.isLoading) return <Spinner />
  const queryFailed = sections.isError || tables.isError || sessions.isError
  const queryError = sections.error ?? tables.error ?? sessions.error

  return (
    <div className="min-w-0 space-y-4">
      {moving?.session && (
        <MoveTableSession source={moving} sessionId={moving.session.id}
          onClose={() => setMoving(null)} />
      )}
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Salón</h1>
        <p className="text-sm text-neutral-500">
          Plano operativo de las mesas disponibles, organizado por sector.
        </p>
      </div>

      {queryFailed ? (
        <ErrorText error={queryError} fallback="No pudimos cargar el plano del salón." />
      ) : floorSections.length === 0 ? (
        <EmptyState message="Todavía no hay sectores activos configurados para operar." />
      ) : (
        <>
          {/* Elegir sector es elegir una opción de un grupo, no cambiar de pestaña:
              botones con aria-pressed, sin el contrato de teclado de un tablist.
              `*:shrink-0` evita que un nombre largo se parta al desplazar la fila. */}
          <div className="flex gap-2 overflow-x-auto pb-1 *:shrink-0" role="group" aria-label="Sectores del salón">
            {floorSections.map((section) => (
              <ChoiceChip
                key={section.id}
                tone="outline"
                pressed={section.id === sectionId}
                onClick={() => chooseSection(section.id)}
              >
                {section.name}
              </ChoiceChip>
            ))}
          </div>

          {activeSection && (
            <section aria-labelledby="floor-map-heading" className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="floor-map-heading" className="text-sm font-semibold text-neutral-800">
                    {activeSection.name}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {countLabel(entries.length, 'mesa operativa', 'mesas operativas')} ·{' '}
                    {countLabel(occupied, 'ocupada')}
                  </p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  <Move size={14} aria-hidden="true" />
                  Deslizá para recorrer · tocá una mesa para ver su resumen
                </p>
              </div>
              <StateLegend />
              <FloorSurface
                key={activeSection.id}
                entries={entries}
                onMoveTable={setMoving}
                onOpenTable={(tableId) =>
                  navigate({
                    pathname: `/salon/${tableId}`,
                    search: searchParams.toString(),
                  })
                }
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Una mesa del plano con lo que el POS sabe de ella. Tiene la forma de una mesa,
 * así `FloorGrid` la recibe tal cual y cada mesa se dibuja con su sesión a mano.
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

function StateLegend() {
  return (
    <ul className="flex gap-x-4 gap-y-1 overflow-x-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-600">
      {posTableStates.map((state) => (
        <li key={state} className="flex shrink-0 items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${tableStateStyles[state].dot}`} aria-hidden="true" />
          {posTableStateLabels[state]}
        </li>
      ))}
    </ul>
  )
}

function FloorSurface({
  entries,
  onOpenTable,
  onMoveTable,
}: {
  entries: FloorMapEntry[]
  onOpenTable: (tableId: string) => void
  onMoveTable: (entry: FloorMapEntry) => void
}) {
  // Las mesas muestran cuánto hace que se abrieron: el plano es lo que el reloj
  // tiene que redibujar, no la pantalla con sus pestañas y su leyenda.
  const now = useNow()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = entries.find((entry) => entry.id === selectedId)

  return (
    <div className="min-w-0 space-y-2">
      {selected && <TableSummary entry={selected} onOpen={onOpenTable} onMove={onMoveTable} />}
      <div
        className="max-h-[calc(100dvh-18rem)] min-h-80 overflow-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
        tabIndex={0}
        aria-label="Plano desplazable del sector"
      >
        <FloorGrid
          tables={entries}
          ariaLabel="Mesas del sector"
          emptyMessage="Este sector todavía no tiene mesas operativas."
          renderTable={(table, tile) => {
            const { session, state } = table
            const selectedTable = selectedId === table.id
            const operator = session?.assigned_employee_name ?? 'Sin asignar'
            const total = visibleTotal(session)
            const elapsed = session && formatElapsed(session.opened_at, now, 'exact')
            const summary = session
              ? `${elapsed}${total === null ? '' : `, ${total}`}, ${operator}`
              : `${table.seats} lugares`

            return (
              <button
                key={table.id}
                type="button"
                onClick={() => setSelectedId(table.id)}
                onDoubleClick={() => onOpenTable(table.id)}
                aria-pressed={selectedTable}
                aria-label={`${table.label}, ${posTableStateLabels[state]}, ${summary}`}
                className={`absolute flex cursor-pointer flex-col items-center justify-center overflow-hidden border-2 text-center shadow-sm transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none ${tableStateStyles[state].tile} ${
                  selectedTable ? 'ring-2 ring-indigo-600 ring-offset-2' : ''
                } ${table.shape === 'round' ? 'rounded-full' : 'rounded-xl'}`}
                style={tile.box}
              >
                <span className="max-w-full truncate px-1 text-xs font-bold leading-tight">{table.label}</span>
                <span className={`mt-0.5 max-w-[90%] truncate rounded px-1 py-0.5 text-[9px] font-semibold leading-none ${tableStateStyles[state].tileLabel}`}>
                  {posTableStateLabels[state]}
                </span>
                {session ? (
                  <>
                    <span className="mt-1 max-w-[90%] truncate text-[10px] font-medium leading-none">
                      {elapsed}
                    </span>
                    {total !== null && (
                      <span className="mt-1 max-w-[90%] truncate text-[10px] font-semibold leading-none">
                        {total}
                      </span>
                    )}
                    <span className="mt-1 max-w-[90%] truncate text-[9px] leading-none opacity-75">
                      {operator}
                    </span>
                  </>
                ) : (
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] leading-none opacity-70">
                    <Users size={11} aria-hidden="true" />
                    {table.seats}
                  </span>
                )}
              </button>
            )
          }}
        />
      </div>
    </div>
  )
}

function TableSummary({
  entry,
  onOpen,
  onMove,
}: {
  entry: FloorMapEntry
  onOpen: (tableId: string) => void
  onMove: (entry: FloorMapEntry) => void
}) {
  const can = useCan()
  const { session, state } = entry
  const total = visibleTotal(session)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm">
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
    </div>
  )
}

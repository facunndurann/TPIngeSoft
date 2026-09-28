import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { formatElapsed, formatPrice, getPosTableState, type PosTableState, posTableStateLabels } from '@restaurant-platform/shared'
import { ClipboardList, Clock3, Move, UserRound, Users } from 'lucide-react'
import { Button, EmptyState, ErrorText, FloorGrid, Spinner, SummaryItem, useNow } from '@restaurant-platform/ui'
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
  const now = useNow()
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
    return { table, session, state: getPosTableState(session) }
  })

  if (sections.isLoading || tables.isLoading || sessions.isLoading) return <Spinner />
  const queryFailed = sections.isError || tables.isError || sessions.isError
  const queryError = sections.error ?? tables.error ?? sessions.error

  return (
    <div className="min-w-0 space-y-4">
      {moving?.session && (
        <MoveTableSession source={moving.table} sessionId={moving.session.id}
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
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Sectores del salón"
          >
            {floorSections.map((section) => {
              const selected = section.id === sectionId
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => chooseSection(section.id)}
                  className={`shrink-0 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    selected
                      ? 'bg-indigo-600 text-white'
                      : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {section.name}
                </button>
              )
            })}
          </div>

          {activeSection && (
            <section aria-labelledby="floor-map-heading" className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="floor-map-heading" className="text-sm font-semibold text-neutral-800">
                    {activeSection.name}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {entries.length} mesa{entries.length === 1 ? '' : 's'} operativa
                    {entries.length === 1 ? '' : 's'} ·{' '}
                    {entries.filter((entry) => entry.state !== 'free').length} ocupada
                    {entries.filter((entry) => entry.state !== 'free').length === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  <Move size={14} aria-hidden="true" />
                  Deslizá para recorrer · tocá una mesa para ver su comanda
                </p>
              </div>
              <StateLegend />
              <FloorSurface
                key={activeSection.id}
                entries={entries}
                now={now}
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

type FloorMapEntry = {
  table: PosDiningTable
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

const stateStyles: Record<PosTableState, { table: string; badge: string; dot: string }> = {
  free: {
    table: 'border-emerald-400 bg-emerald-50 text-emerald-950',
    badge: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  occupied: {
    table: 'border-neutral-400 bg-neutral-100 text-neutral-900',
    badge: 'bg-neutral-200 text-neutral-700',
    dot: 'bg-neutral-500',
  },
  order_pending: {
    table: 'border-amber-500 bg-amber-50 text-amber-950',
    badge: 'bg-amber-200 text-amber-900',
    dot: 'bg-amber-500',
  },
  in_preparation: {
    table: 'border-blue-500 bg-blue-50 text-blue-950',
    badge: 'bg-blue-200 text-blue-900',
    dot: 'bg-blue-500',
  },
  ready: {
    table: 'border-cyan-600 bg-cyan-50 text-cyan-950',
    badge: 'bg-cyan-200 text-cyan-950',
    dot: 'bg-cyan-600',
  },
  bill_requested: {
    table: 'border-violet-600 bg-violet-50 text-violet-950',
    badge: 'bg-violet-200 text-violet-950',
    dot: 'bg-violet-600',
  },
  in_person_payment: {
    table: 'border-red-600 bg-red-50 text-red-950',
    badge: 'bg-red-200 text-red-950',
    dot: 'bg-red-600',
  },
  payment_pending: {
    table: 'border-rose-600 bg-rose-50 text-rose-950',
    badge: 'bg-rose-200 text-rose-950',
    dot: 'bg-rose-600',
  },
}

const legendStates: PosTableState[] = [
  'free',
  'occupied',
  'order_pending',
  'in_preparation',
  'ready',
  'bill_requested',
  'in_person_payment',
  'payment_pending',
]

function StateLegend() {
  return (
    <ul className="flex gap-x-4 gap-y-1 overflow-x-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-600">
      {legendStates.map((state) => (
        <li key={state} className="flex shrink-0 items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${stateStyles[state].dot}`} aria-hidden="true" />
          {posTableStateLabels[state]}
        </li>
      ))}
    </ul>
  )
}

function FloorSurface({
  entries,
  now,
  onOpenTable,
  onMoveTable,
}: {
  entries: FloorMapEntry[]
  now: number
  onOpenTable: (tableId: string) => void
  onMoveTable: (entry: FloorMapEntry) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = entries.find((entry) => entry.table.id === selectedId)

  return (
    <div className="min-w-0 space-y-2">
      {selected && <TableSummary entry={selected} now={now} onOpen={onOpenTable} onMove={onMoveTable} />}
      <div
        className="max-h-[calc(100dvh-18rem)] min-h-80 overflow-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
        tabIndex={0}
        aria-label="Plano desplazable del sector"
      >
        <FloorGrid
          tables={entries.map((entry) => entry.table)}
          ariaLabel="Mesas del sector"
          emptyMessage="Este sector todavía no tiene mesas operativas."
          renderTable={(table, tile) => {
            const { session, state } = entries.find((entry) => entry.table.id === table.id)!
            const selectedTable = selectedId === table.id
            const operator = session?.assigned_employee_name ?? 'Sin asignar'
            const total = visibleTotal(session)
            const summary = session
              ? `${formatElapsed(session.opened_at, now, 'exact')}${total === null ? '' : `, ${total}`}, ${operator}`
              : `${table.seats} lugares`

            return (
              <button
                key={table.id}
                type="button"
                onClick={() => setSelectedId(table.id)}
                onDoubleClick={() => onOpenTable(table.id)}
                aria-pressed={selectedTable}
                aria-label={`${table.label}, ${posTableStateLabels[state]}, ${summary}`}
                className={`absolute flex cursor-pointer flex-col items-center justify-center overflow-hidden border-2 text-center shadow-sm transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none ${stateStyles[state].table} ${
                  selectedTable ? 'ring-2 ring-indigo-600 ring-offset-2' : ''
                } ${table.shape === 'round' ? 'rounded-full' : 'rounded-xl'}`}
                style={tile.box}
              >
                <span className="max-w-full truncate px-1 text-xs font-bold leading-tight">{table.label}</span>
                <span className={`mt-0.5 max-w-[90%] truncate rounded px-1 py-0.5 text-[9px] font-semibold leading-none ${stateStyles[state].badge}`}>
                  {posTableStateLabels[state]}
                </span>
                {session ? (
                  <>
                    <span className="mt-1 max-w-[90%] truncate text-[10px] font-medium leading-none">
                      {formatElapsed(session.opened_at, now, 'exact')}
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
  now,
  onOpen,
  onMove,
}: {
  entry: FloorMapEntry
  now: number
  onOpen: (tableId: string) => void
  onMove: (entry: FloorMapEntry) => void
}) {
  const can = useCan()
  const { table, session, state } = entry
  const total = visibleTotal(session)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div className="mr-auto space-y-1">
        <p className="font-semibold text-neutral-900">{table.label}</p>
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${stateStyles[state].badge}`}>
          {posTableStateLabels[state]}
        </span>
        {session && <SessionRequestBadges session={session} now={now} />}
      </div>
      {session ? (
        <>
          <SummaryItem icon={Clock3} label="Abierta" value={formatElapsed(session.opened_at, now, 'exact')} />
          {total !== null && <SummaryItem label="Total acumulado" value={total} />}
          <SummaryItem label="Pedidos activos" value={String(session.kitchen_tickets)} />
          <SummaryItem
            icon={UserRound}
            label="Responsable"
            value={session.assigned_employee_name ?? 'Sin asignar'}
          />
        </>
      ) : (
        <SummaryItem icon={Users} label="Capacidad" value={`${table.seats} lugares`} />
      )}
      {session && <AttendRequestButtons sessionId={session.id} session={session} />}
      {session && can('sessions.move') && (
        <Button variant="secondary" onClick={() => onMove(entry)}>
          <Move size={15} /> Mover comanda
        </Button>
      )}
      <Button onClick={() => onOpen(table.id)}>
        <ClipboardList size={15} />
        {session ? 'Continuar comanda' : 'Abrir comanda'}
      </Button>
    </div>
  )
}

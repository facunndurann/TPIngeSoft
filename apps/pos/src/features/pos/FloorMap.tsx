import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { getPosTableState } from '@restaurant-platform/shared'
import { ClipboardList, Clock3, Move, UserRound, Users, X } from 'lucide-react'
import { Button, Elapsed, IconButton, QueryView, SectionPills, SummaryItem } from '@restaurant-platform/ui'
import { useCan, usePosScope } from '@/context/pos-context'
import { visibleTotal, type FloorMapEntry } from './floorEntry'
import { FloorSurface } from './FloorSurface'
import { MoveTableSession } from './MoveTableSession'
import {
  posFloorSectionsQuery,
  posOpenSessionsQuery,
  posTablesQuery,
  type PosDiningTable,
  type PosFloorSection,
  type PosOpenSession,
} from './queries'
import { AttendRequestButtons, SessionRequestBadges } from './ServiceRequests'
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
      <h1 className="text-xl font-bold text-neutral-900">Salón</h1>

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
  // La comanda conserva el sector: volver desde ella deja el plano donde estaba.
  const openCommand = (tableId: string) =>
    navigate({
      pathname: `/salon/${tableId}`,
      search: searchParams.toString(),
    })

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
        onOpenTable={openCommand}
        renderSummary={(entry, close) => (
          <TableSummary entry={entry} onOpen={openCommand} onMove={setMoving} onClose={close} />
        )}
      />
    </>
  )
}

/**
 * Lo que se sabe de la mesa elegida y lo que se puede hacer con ella: abrir o
 * seguir su comanda, mover la comanda a otra mesa y atender lo que pidieron.
 */
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

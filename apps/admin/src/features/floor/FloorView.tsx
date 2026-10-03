import { countLabel, isOperable } from '@restaurant-platform/shared'
import { EmptyState } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable } from '@/queries/floor'
import { FloorCanvas } from './FloorCanvas'
import { FloorLayout } from './FloorLayout'
import { FloorLegend } from './FloorTableTile'
import { SectionTables } from './SectionTables'
import { SectionTabs } from './SectionTabs'
import type { Floor, FloorScreenProps } from './floor'
import { useFloorCamera } from './useFloorCamera'

/** El plano en modo vista: el mismo que ve el personal, de solo lectura. */
export function FloorView({ floor, section, onChooseSection }: FloorScreenProps) {
  if (!section) {
    return <EmptyState message="Todavía no hay sectores. Pasá a editar para crear el primero." />
  }

  return (
    <>
      <SectionTabs floor={floor} activeId={section.id} onChoose={onChooseSection} />
      <SectionView floor={floor} section={section} />
    </>
  )
}

function SectionView({ floor, section }: { floor: Floor; section: FloorSection }) {
  const tables = floor.tablesIn(section.id)
  const camera = useFloorCamera(tables)
  const unassigned = floor.tablesIn(null).length

  return (
    <FloorLayout
      plan={
        <>
          <FloorCanvas tables={tables} camera={camera} toolbar={<SectionStatus section={section} />} />
          <FloorLegend editing={false} />
        </>
      }
      panel={
        <SectionTables tables={tables} summary={summaryOf(tables, section)}>
          {/* En el panel y no debajo del plano: ahí empujaría la página más allá de la pantalla. */}
          {unassigned > 0 && (
            <p className="mt-1 border-t border-neutral-200 px-2 pt-4 text-xs text-muted">
              {countLabel(unassigned, 'mesa sin sector no aparece', 'mesas sin sector no aparecen')} en ningún
              plano. Pasá a editar para ubicarlas.
            </p>
          )}
        </SectionTables>
      }
    />
  )
}

/**
 * Si el POS ofrece las mesas de este sector. El punto acompaña al texto: el
 * color solo no dice nada a quien no lo distingue.
 */
function SectionStatus({ section }: { section: FloorSection }) {
  return (
    <p className="ml-auto flex min-h-11 items-center gap-2.5 px-2 text-sm font-semibold text-muted">
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full ${section.is_active ? 'bg-green-600' : 'bg-neutral-400'}`}
      />
      {section.is_active ? 'Sector en uso' : 'Sector sin uso: el POS no ofrece sus mesas'}
    </p>
  )
}

/** Lo que el encargado quiere saber del sector sin abrir cada mesa. */
function summaryOf(tables: FloorTable[], section: FloorSection) {
  const operable = tables.filter((table) => isOperable(table, section))
  const seats = operable.reduce((total, table) => total + table.seats, 0)
  return `${countLabel(operable.length, 'mesa operable', 'mesas operables')} · ${countLabel(seats, 'lugar', 'lugares')}`
}

import { useState } from 'react'
import { QrCode } from 'lucide-react'
import { countLabel, isOperable, tablePlacement } from '@restaurant-platform/shared'
import { EmptyState, FloorPlan, floorTile, useFloorCamera } from '@restaurant-platform/ui'
import { QrModal } from '@/features/QrModal'
import type { FloorSection, FloorTable } from '@/queries/floor'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { FloorLayout } from './FloorLayout'
import { SectionTables } from './SectionTables'
import { SectionTabs } from './SectionTabs'
import { FloorLegend, TableTile } from './TableTile'
import type { Floor, FloorScreenProps } from './floor'

/**
 * El plano en modo vista: el mismo que ve el personal, de solo lectura. Tocar una
 * mesa, en el plano o en la lista, muestra su QR, como en Mesas y QR.
 */
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
  const restaurant = useRestaurant()
  const tables = floor.tablesIn(section.id)
  const camera = useFloorCamera(tables)
  const unassigned = floor.tablesIn(null).length
  // El id y no la mesa: si la mesa cambia con el QR abierto, el modal muestra lo
  // último; si se borra, se cierra.
  const [qrTableId, setQrTableId] = useState<string | null>(null)
  const qrTable = tables.find((table) => table.id === qrTableId)
  const openQr = (table: FloorTable) => setQrTableId(table.id)

  return (
    <>
      <FloorLayout
        plan={
          <>
            <FloorPlan
              camera={camera}
              tables={tables}
              emptyMessage="Este sector todavía no tiene mesas."
              // Las mesas de la vista dejan pasar el apretón: un toque sobre una (o
              // Enter, con el teclado) muestra su QR, y un arrastre que empieza ahí
              // mueve el piso.
              onTap={(table) => {
                if (table) openQr(table)
              }}
              toolbar={<SectionStatus section={section} />}
              renderTable={(table, events) => (
                <TableTile
                  table={table}
                  tile={floorTile(table, tablePlacement(table))}
                  zoom={camera.zoom}
                  events={events}
                />
              )}
            />
            <FloorLegend editing={false} />
          </>
        }
        panel={
          <SectionTables
            tables={tables}
            onChoose={openQr}
            chooseIcon={QrCode}
            empty="Este sector todavía no tiene mesas."
            summary={summaryOf(tables, section)}
          >
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
      {qrTable && <QrModal table={qrTable} restaurantName={restaurant.name} onClose={() => setQrTableId(null)} />}
    </>
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

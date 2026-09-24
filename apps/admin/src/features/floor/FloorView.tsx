import { useState } from 'react'
import { isOperable } from '@restaurant-platform/shared'
import { EmptyState } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable } from '@/queries/floor'
import { FloorCanvas } from './FloorCanvas'
import type { Floor } from './useFloor'

type FloorViewProps = {
  floor: Floor
  /** Sector abierto; `null` si la sucursal todavía no tiene ninguno. */
  section: FloorSection | null
}

/** El plano en modo visualizar: el mismo que ve el personal, de solo lectura. */
export function FloorView({ floor, section }: FloorViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (!section) {
    return <EmptyState message="Todavía no hay sectores. Pasá a editar para crear el primero." />
  }

  const tables = floor.tablesIn(section.id)
  const unassigned = floor.tablesIn(null).length

  return (
    <div className="space-y-3">
      <SectionSummary tables={tables} section={section} />
      <FloorCanvas tables={tables} selectedId={selectedId} onSelect={setSelectedId} />
      {unassigned > 0 && (
        <p className="text-xs text-neutral-500">
          {unassigned} mesa(s) sin sector no aparecen en ningún plano. Pasá a editar para
          ubicarlas.
        </p>
      )}
    </div>
  )
}

/** Lo que el encargado quiere saber del sector sin abrir cada mesa. */
function SectionSummary({ tables, section }: { tables: FloorTable[]; section: FloorSection }) {
  const operable = tables.filter((table) => isOperable(table, section))
  const seats = operable.reduce((total, table) => total + table.seats, 0)
  const hidden = tables.length - operable.length

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
      <div>
        <dt className="text-xs text-neutral-500">Mesas operables</dt>
        <dd className="font-semibold text-neutral-900">{operable.length}</dd>
      </div>
      <div>
        <dt className="text-xs text-neutral-500">Lugares</dt>
        <dd className="font-semibold text-neutral-900">{seats}</dd>
      </div>
      {hidden > 0 && (
        <div>
          <dt className="text-xs text-neutral-500">Fuera de operación</dt>
          <dd className="font-semibold text-neutral-500">{hidden}</dd>
        </div>
      )}
      {!section.is_active && (
        <p className="self-center rounded-lg bg-amber-50 px-3 py-1 text-xs text-amber-900">
          Sector sin uso: el POS no ofrece ninguna de estas mesas.
        </p>
      )}
    </dl>
  )
}

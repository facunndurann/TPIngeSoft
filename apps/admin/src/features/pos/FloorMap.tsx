import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FLOOR_GRID, clampToGrid, tableFootprint } from '@restaurant-platform/shared'
import { Move, Users } from 'lucide-react'
import { EmptyState, ErrorText, Select, Spinner } from '@/components/ui'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { loadPosFloorSections, loadRestaurantTables } from './api'
import type { PosDiningTable } from './types'

/**
 * Plano operativo del salón (MI-62).
 *
 * El estado de las mesas y las acciones sobre la comanda pertenecen a las
 * fases siguientes. Esta vista se limita a representar fielmente el layout
 * configurado por el administrador y a navegarlo por sucursal/sector.
 */
export function FloorMap() {
  const restaurant = useRestaurant()
  const [branchChoice, setBranchChoice] = useState<string | null>(null)
  const [sectionChoice, setSectionChoice] = useState<string | null>(null)

  const sections = useQuery({
    queryKey: ['pos', restaurant.id, 'floor-sections'],
    queryFn: () => loadPosFloorSections(restaurant.id),
  })
  const tables = useQuery({
    queryKey: ['pos', restaurant.id, 'tables'],
    queryFn: () => loadRestaurantTables(restaurant.id),
  })

  const branches = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const section of sections.data ?? []) {
      if (section.branches) byId.set(section.branches.id, section.branches)
    }
    return [...byId.values()]
  }, [sections.data])

  const branchId = branches.some((branch) => branch.id === branchChoice)
    ? branchChoice
    : (branches[0]?.id ?? null)
  const branchSections = (sections.data ?? []).filter((section) => section.branch_id === branchId)
  const sectionId = branchSections.some((section) => section.id === sectionChoice)
    ? sectionChoice
    : (branchSections[0]?.id ?? null)
  const sectionTables = (tables.data ?? []).filter((table) => table.section_id === sectionId)
  const activeSection = branchSections.find((section) => section.id === sectionId)

  if (sections.isLoading || tables.isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Salón</h1>
          <p className="text-sm text-neutral-500">
            Plano operativo de las mesas disponibles, organizado por sector.
          </p>
        </div>
        {branches.length > 1 && (
          <label className="w-56">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Sucursal</span>
            <Select
              value={branchId ?? ''}
              onChange={(event) => {
                setBranchChoice(event.target.value)
                setSectionChoice(null)
              }}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      {(sections.isError || tables.isError) && (
        <ErrorText message="No pudimos cargar el plano del salón." />
      )}

      {!sections.isError && branches.length === 0 ? (
        <EmptyState message="Todavía no hay sectores activos configurados para operar." />
      ) : (
        <>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Sectores del salón"
          >
            {branchSections.map((section) => {
              const selected = section.id === sectionId
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setSectionChoice(section.id)}
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
            <section aria-labelledby="floor-map-heading" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="floor-map-heading" className="text-sm font-semibold text-neutral-800">
                    {activeSection.name}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {sectionTables.length} mesa{sectionTables.length === 1 ? '' : 's'} operativa
                    {sectionTables.length === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  <Move size={14} aria-hidden="true" />
                  Deslizá para recorrer el plano
                </p>
              </div>
              <FloorSurface key={activeSection.id} tables={sectionTables} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

function FloorSurface({ tables }: { tables: PosDiningTable[] }) {
  return (
    <div
      className="max-h-[calc(100dvh-15rem)] min-h-80 overflow-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
      tabIndex={0}
      aria-label="Plano desplazable del sector"
    >
      <div
        className="relative"
        style={{
          width: FLOOR_GRID.cols * FLOOR_GRID.cell,
          height: FLOOR_GRID.rows * FLOOR_GRID.cell,
          backgroundSize: `${FLOOR_GRID.cell}px ${FLOOR_GRID.cell}px`,
          backgroundImage:
            'linear-gradient(to right, #f1f1f1 1px, transparent 1px), linear-gradient(to bottom, #f1f1f1 1px, transparent 1px)',
        }}
        role="list"
        aria-label="Mesas del sector"
      >
        {tables.map((table) => {
          const footprint = tableFootprint(table)
          const position = clampToGrid(table.position_x, table.position_y, footprint)

          return (
            <div
              key={table.id}
              role="listitem"
              aria-label={`${table.label}, ${table.seats} lugares`}
              className={`absolute flex flex-col items-center justify-center overflow-hidden border-2 border-neutral-400 bg-neutral-50 text-center text-neutral-800 shadow-sm ${
                table.shape === 'round' ? 'rounded-full' : 'rounded-xl'
              }`}
              style={{
                left: position.x * FLOOR_GRID.cell + 3,
                top: position.y * FLOOR_GRID.cell + 3,
                width: footprint.w * FLOOR_GRID.cell - 6,
                height: footprint.h * FLOOR_GRID.cell - 6,
              }}
            >
              <span className="max-w-full truncate px-2 text-sm font-semibold">{table.label}</span>
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-500">
                <Users size={12} aria-hidden="true" />
                {table.seats}
              </span>
            </div>
          )
        })}

        {tables.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
            Este sector todavía no tiene mesas operativas.
          </p>
        )}
      </div>
    </div>
  )
}

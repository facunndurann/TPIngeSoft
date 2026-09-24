import { useState, type ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, SquarePen } from 'lucide-react'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, EmptyState, Select, Spinner } from '@restaurant-platform/ui'
import { FloorEditor } from '@/features/floor/FloorEditor'
import { FloorView } from '@/features/floor/FloorView'
import { useFloor, type Floor } from '@/features/floor/useFloor'
import { branchesQuery } from '@/queries/branches'
import type { FloorSection, FloorTable } from '@/queries/floor'

/** Lo que recibe la pantalla de cada modo. */
type FloorScreenProps = { branchId: string; floor: Floor; section: FloorSection | null }

const MODE_IDS = ['view', 'edit'] as const
type Mode = (typeof MODE_IDS)[number]

/**
 * Todo lo que cambia con el modo, en un solo lugar: ningún JSX de la página
 * pregunta en qué modo está.
 */
const MODES: Record<
  Mode,
  { label: string; icon: typeof Eye; description: string; Screen: ComponentType<FloorScreenProps> }
> = {
  view: {
    label: 'Visualizar',
    icon: Eye,
    description: 'Así ve el salón el personal. Pasá a editar para cambiar el plano.',
    Screen: FloorView,
  },
  edit: {
    label: 'Editar',
    icon: SquarePen,
    description: 'Creá sectores, agregá mesas y ubicalas como están en la realidad.',
    Screen: FloorEditor,
  },
}

/** Elige sucursal y modo; el plano de cada sucursal vive en `BranchFloor`. */
export function FloorPlanPage() {
  const restaurant = useRestaurant()
  const [mode, setMode] = useState<Mode>('view')
  const [branchChoice, setBranchChoice] = useState<string | null>(null)

  const branches = useQuery(branchesQuery(restaurant.id))
  const branchId = branchChoice ?? branches.data?.[0]?.id ?? null

  if (branches.isLoading) return <Spinner />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Salón</h1>
          <p className="text-sm text-muted">{MODES[mode].description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(branches.data?.length ?? 0) > 1 && (
            <Select
              className="w-56"
              value={branchId ?? ''}
              onChange={(event) => setBranchChoice(event.target.value)}
              aria-label="Sucursal"
            >
              {branches.data?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
          <ModeSwitch mode={mode} onChange={setMode} />
        </div>
      </div>

      {branchId ? (
        // Otra sucursal es otro plano: la key vuelve al primer sector y descarta
        // la selección, sin resetear nada a mano.
        <BranchFloor key={branchId} branchId={branchId} mode={mode} />
      ) : (
        <EmptyState message="Todavía no hay sucursales. Creá una en Restaurante." />
      )}
    </div>
  )
}

function BranchFloor({ branchId, mode }: { branchId: string; mode: Mode }) {
  const floor = useFloor(branchId)
  const [sectionChoice, setSectionChoice] = useState<string | null>(null)
  // Si el sector elegido deja de existir (se borró), se abre el primero.
  const section =
    floor.sections.find((entry) => entry.id === sectionChoice) ?? floor.sections[0] ?? null
  const { Screen } = MODES[mode]

  return (
    <>
      <SectionTabs
        sections={floor.sections}
        activeId={section?.id ?? null}
        onChoose={setSectionChoice}
        tables={floor.tables}
      />
      {floor.isLoading ? (
        <Spinner />
      ) : (
        // Cambiar de modo o de sector remonta la pantalla: selección, formularios
        // y errores arrancan de cero.
        <Screen key={section?.id} branchId={branchId} floor={floor} section={section} />
      )}
    </>
  )
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div
      className="flex rounded-lg border border-neutral-200 bg-white p-1"
      role="group"
      aria-label="Modo del plano"
    >
      {MODE_IDS.map((id) => {
        const { label, icon: Icon } = MODES[id]
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={mode === id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === id ? 'bg-primary text-white' : 'text-muted hover:bg-neutral-100'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

function SectionTabs({
  sections,
  activeId,
  onChoose,
  tables,
}: {
  sections: FloorSection[]
  activeId: string | null
  onChoose: (id: string) => void
  tables: FloorTable[]
}) {
  if (sections.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sections.map((entry) => {
        const count = tables.filter((table) => table.section_id === entry.id).length
        return (
          <button
            key={entry.id}
            onClick={() => onChoose(entry.id)}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              entry.id === activeId
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-neutral-200 bg-white text-muted hover:bg-neutral-50'
            }`}
          >
            {entry.name}
            <span className="text-xs opacity-60">{count}</span>
            {!entry.is_active && <Badge color="red">Sin uso</Badge>}
          </button>
        )
      })}
    </div>
  )
}

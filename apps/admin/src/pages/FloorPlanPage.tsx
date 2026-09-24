import { useState, type ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, SquarePen } from 'lucide-react'
import { Page } from '@/features/Page'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, ChoiceChip, EmptyState, Select, Spinner } from '@restaurant-platform/ui'
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
    <Page
      title="Salón"
      description={MODES[mode].description}
      wide
      actions={
        <>
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
        </>
      }
    >
      {branchId ? (
        // Otra sucursal es otro plano: la key vuelve al primer sector y descarta
        // la selección, sin resetear nada a mano.
        <BranchFloor key={branchId} branchId={branchId} mode={mode} />
      ) : (
        <EmptyState message="Todavía no hay sucursales. Creá una en Restaurante." />
      )}
    </Page>
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
            // Dice en qué modo se está, no es una acción: el color lleno queda para
            // «Agregar al sector», el único botón principal del Salón.
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === id ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-neutral-100'
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
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sectores">
      {sections.map((entry) => {
        const count = tables.filter((table) => table.section_id === entry.id).length
        return (
          <ChoiceChip
            key={entry.id}
            tone="outline"
            pressed={entry.id === activeId}
            onClick={() => onChoose(entry.id)}
          >
            {entry.name}
            {/* Se distingue por tamaño y peso, no con opacidad: atenuada no llegaba
                a 4,5:1 sobre el fondo del sector elegido. Se lee «4 mesas». */}
            <span className="text-xs font-normal tabular-nums">
              {count}
              <span className="sr-only"> {count === 1 ? 'mesa' : 'mesas'}</span>
            </span>
            {!entry.is_active && <Badge color="red">Sin uso</Badge>}
          </ChoiceChip>
        )
      })}
    </div>
  )
}

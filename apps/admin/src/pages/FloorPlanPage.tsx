import { useState, type ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/features/Page'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { QueryView, Select } from '@restaurant-platform/ui'
import { FloorEditor } from '@/features/floor/FloorEditor'
import { FloorView } from '@/features/floor/FloorView'
import { floorOf, type FloorScreenProps } from '@/features/floor/floor'
import { branchesQuery } from '@/queries/branches'
import { sectionsQuery, tablesQuery } from '@/queries/floor'

/** En el orden del selector: editar es lo que se viene a hacer al Salón. */
const MODE_IDS = ['edit', 'view'] as const
type Mode = (typeof MODE_IDS)[number]

/**
 * Todo lo que cambia con el modo, en un solo lugar: ningún JSX de la página
 * pregunta en qué modo está.
 */
const MODES: Record<Mode, { label: string; Screen: ComponentType<FloorScreenProps> }> = {
  edit: { label: 'Editar', Screen: FloorEditor },
  view: { label: 'Vista', Screen: FloorView },
}

/** Elige sucursal y modo; el plano de cada sucursal vive en `BranchFloor`. */
export function FloorPlanPage() {
  const restaurant = useRestaurant()
  const [mode, setMode] = useState<Mode>('view')
  const [branchChoice, setBranchChoice] = useState<string | null>(null)

  const branches = useQuery(branchesQuery(restaurant.id))
  const chosenBranch = (list: { id: string }[]) => branchChoice ?? list[0].id

  return (
    <Page
      title="Salón"
      wide
      fill
      actions={
        <>
          {/* Con una sola sucursal, o mientras cargan, no hay nada que elegir. */}
          {branches.data && branches.data.length > 1 && (
            <Select
              size="touch"
              className="w-56"
              value={chosenBranch(branches.data)}
              onChange={(event) => setBranchChoice(event.target.value)}
              aria-label="Sucursal"
            >
              {branches.data.map((branch) => (
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
      <QueryView query={branches} empty="Todavía no hay sucursales. Creá una en Restaurante.">
        {(branches) => {
          const branchId = chosenBranch(branches)
          // Otra sucursal es otro plano: la key vuelve al primer sector y descarta
          // la selección, sin resetear nada a mano.
          return <BranchFloor key={branchId} branchId={branchId} mode={mode} />
        }}
      </QueryView>
    </Page>
  )
}

function BranchFloor({ branchId, mode }: { branchId: string; mode: Mode }) {
  const sections = useQuery(sectionsQuery(branchId))
  const tables = useQuery(tablesQuery(branchId))
  const [sectionChoice, setSectionChoice] = useState<string | null>(null)
  const { Screen } = MODES[mode]

  return (
    <QueryView query={[sections, tables]}>
      {([sections, tables]) => {
        // Si el sector elegido deja de existir (se borró), se abre el primero.
        const section = sections.find((entry) => entry.id === sectionChoice) ?? sections[0] ?? null
        // Cambiar de modo o de sector remonta la pantalla: selección, formularios,
        // errores e historial de deshacer arrancan de cero.
        return (
          <Screen
            key={section?.id}
            branchId={branchId}
            floor={floorOf(sections, tables)}
            section={section}
            onChooseSection={setSectionChoice}
          />
        )
      }}
    </QueryView>
  )
}

/** Editar o Vista, como un interruptor de dos posiciones. */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="flex gap-1 rounded-full border border-neutral-200 bg-white p-1" role="group" aria-label="Modo del plano">
      {MODE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={mode === id}
          className={`min-h-11 cursor-pointer rounded-full px-5 text-sm transition-colors ${
            mode === id ? 'bg-primary font-semibold text-white' : 'font-medium text-muted hover:bg-neutral-100'
          }`}
        >
          {MODES[id].label}
        </button>
      ))}
    </div>
  )
}

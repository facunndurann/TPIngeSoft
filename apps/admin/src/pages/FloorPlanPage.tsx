import type { ComponentType } from 'react'
import { useSearchParams } from 'react-router'
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
 * pregunta en qué modo está. `param` es como se escribe en la URL (`?modo=editar`).
 */
const MODES: Record<Mode, { label: string; param: string; Screen: ComponentType<FloorScreenProps> }> = {
  edit: { label: 'Editar', param: 'editar', Screen: FloorEditor },
  view: { label: 'Vista', param: 'vista', Screen: FloorView },
}

/**
 * Lo que se eligió en el Salón vive en la URL (`?modo=editar&sucursal=…&sector=…`):
 * recargar no lo pierde y el link lleva al mismo lugar. Elegir reemplaza la
 * entrada del historial en lugar de sumar una, así «atrás» sale del Salón en vez
 * de recorrer cada elección. Lo que falta o ya no existe cae en lo de siempre:
 * Vista, la primera sucursal y su primer sector.
 */
function useFloorChoices() {
  const [params, setParams] = useSearchParams()

  /** Cambia la URL a partir de la actual, sin sumar una entrada al historial. */
  const update = (change: (next: URLSearchParams) => void) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        change(next)
        return next
      },
      { replace: true },
    )

  return {
    mode: MODE_IDS.find((id) => MODES[id].param === params.get('modo')) ?? 'view',
    branchId: params.get('sucursal'),
    sectionId: params.get('sector'),
    chooseMode: (mode: Mode) => update((next) => next.set('modo', MODES[mode].param)),
    chooseBranch: (branchId: string) =>
      update((next) => {
        next.set('sucursal', branchId)
        // Otra sucursal es otro plano: el sector elegido era de la anterior.
        next.delete('sector')
      }),
    chooseSection: (sectionId: string) => update((next) => next.set('sector', sectionId)),
  }
}

/** Elige sucursal y modo; el plano de cada sucursal vive en `BranchFloor`. */
export function FloorPlanPage() {
  const restaurant = useRestaurant()
  const choices = useFloorChoices()

  const branches = useQuery(branchesQuery(restaurant.id))
  // La de la URL si es de este restaurante; si no (un link viejo, otra cuenta), la primera.
  const chosenBranch = (list: { id: string }[]) => (list.find((branch) => branch.id === choices.branchId) ?? list[0]).id

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
              onChange={(event) => choices.chooseBranch(event.target.value)}
              aria-label="Sucursal"
            >
              {branches.data.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
          <ModeSwitch mode={choices.mode} onChange={choices.chooseMode} />
        </>
      }
    >
      <QueryView query={branches} empty="Todavía no hay sucursales. Creá una en Restaurante.">
        {(branches) => {
          const branchId = chosenBranch(branches)
          // Otra sucursal es otro plano: la key lo monta de cero, así la selección
          // y el historial de deshacer no pasan de una a otra.
          return (
            <BranchFloor
              key={branchId}
              branchId={branchId}
              mode={choices.mode}
              sectionChoice={choices.sectionId}
              onChooseSection={choices.chooseSection}
            />
          )
        }}
      </QueryView>
    </Page>
  )
}

function BranchFloor({
  branchId,
  mode,
  sectionChoice,
  onChooseSection,
}: {
  branchId: string
  mode: Mode
  /** El sector de la URL, tal cual: puede no ser de esta sucursal o no existir más. */
  sectionChoice: string | null
  onChooseSection: (sectionId: string) => void
}) {
  const sections = useQuery(sectionsQuery(branchId))
  const tables = useQuery(tablesQuery(branchId))
  const { Screen } = MODES[mode]

  return (
    <QueryView query={[sections, tables]}>
      {([sections, tables]) => {
        // Si el sector elegido no está (se borró, o el link es viejo), se abre el primero.
        const section = sections.find((entry) => entry.id === sectionChoice) ?? sections[0] ?? null
        // Cambiar de modo o de sector remonta la pantalla: selección, formularios,
        // errores e historial de deshacer arrancan de cero.
        return (
          <Screen
            key={section?.id}
            branchId={branchId}
            floor={floorOf(sections, tables)}
            section={section}
            onChooseSection={onChooseSection}
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

import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, LayoutGrid, Pencil, Plus, SquarePen, Trash2, X } from 'lucide-react'
import { findFreeCell, isOperable, resizePlacement, tableFootprint } from '@restaurant-platform/shared'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Input, Select, Spinner, Toggle, useSaveErrors } from '@restaurant-platform/ui'
import { FloorCanvas } from '@/features/floor/FloorCanvas'
import { TableInspector } from '@/features/floor/TableInspector'
import {
  createSection,
  createTable,
  deleteSection,
  deleteTable,
  loadBranches,
  loadSections,
  loadTables,
  updateSection,
  updateTableLayout,
  type FloorSection,
  type FloorTable,
  type TableIntent,
  type TableLayoutPatch,
} from '@/features/floor/floor-api'

type Mode = 'view' | 'edit'

const SAVE_FAILED = 'No pudimos guardar el cambio.'

/** Tamaño de una mesa nueva, en celdas. */
const NEW_TABLE_SPAN = { width: 3, height: 3 }

export function FloorPlanPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('view')
  const [branchChoice, setBranchChoice] = useState<string | null>(null)
  const [sectionChoice, setSectionChoice] = useState<string | null>(null)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [newTableLabel, setNewTableLabel] = useState('')
  const [renaming, setRenaming] = useState<FloorSection | null>(null)
  const errors = useSaveErrors()

  const branches = useQuery({
    queryKey: ['branches', restaurant.id],
    queryFn: () => loadBranches(restaurant.id),
  })
  const branchId = branchChoice ?? branches.data?.[0]?.id ?? null

  const sections = useQuery({
    queryKey: ['floor', branchId, 'sections'],
    queryFn: () => loadSections(branchId!),
    enabled: !!branchId,
  })
  const tables = useQuery({
    queryKey: ['floor', branchId, 'tables'],
    queryFn: () => loadTables(branchId!),
    enabled: !!branchId,
  })

  const sectionId = sectionChoice ?? sections.data?.[0]?.id ?? null
  const section = sections.data?.find((entry) => entry.id === sectionId) ?? null

  const sectionTables = useMemo(
    () => (tables.data ?? []).filter((table) => table.section_id === sectionId),
    [tables.data, sectionId],
  )
  const unassigned = useMemo(
    () => (tables.data ?? []).filter((table) => !table.section_id),
    [tables.data],
  )

  const selectedTable = (tables.data ?? []).find((table) => table.id === selectedTableId) ?? null
  const tablesKey = ['floor', branchId, 'tables'] as const

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
    // La lista de Mesas y QR lee las mismas filas.
    void queryClient.invalidateQueries({ queryKey: ['tables'] })
  }

  /** Toda mutación del plano falla igual: limpia, guarda y reporta. */
  const run = <TArgs,>(mutationFn: (args: TArgs) => Promise<unknown>) =>
    errors.saving(SAVE_FAILED, { mutationFn, onSuccess: refresh })

  function occupiedCells(targetSectionId: string | null, exceptTableId?: string) {
    return (tables.data ?? [])
      .filter((table) => table.section_id === targetSectionId && table.id !== exceptTableId)
      .map((table) => ({
        x: table.position_x,
        y: table.position_y,
        footprint: tableFootprint(table),
      }))
  }

  const addSection = useMutation(
    run((name: string) =>
      createSection({
        restaurantId: restaurant.id,
        branchId: branchId!,
        name,
        sortOrder: sections.data?.length ?? 0,
      }),
    ),
  )
  const patchSection = useMutation(
    run(({ id, patch }: { id: string; patch: Parameters<typeof updateSection>[1] }) =>
      updateSection(id, patch),
    ),
  )
  const removeSection = useMutation(run((id: string) => deleteSection(id)))

  const addTable = useMutation(
    run((label: string) => {
      const { x, y } = findFreeCell(tableFootprint(NEW_TABLE_SPAN), occupiedCells(sectionId))
      return createTable({
        restaurantId: restaurant.id,
        branchId: branchId!,
        sectionId,
        label,
        positionX: x,
        positionY: y,
      })
    }),
  )
  const removeTable = useMutation(run((id: string) => deleteTable(id)))

  const patchTable = useMutation(errors.saving(SAVE_FAILED, {
    mutationFn: ({ id, patch }: { id: string; patch: TableLayoutPatch }) =>
      updateTableLayout(id, patch),
    // Optimista: al soltar una mesa tiene que quedar donde la soltaste, no
    // saltar a la posición vieja hasta que vuelva el refetch.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: tablesKey })
      const previous = queryClient.getQueryData<FloorTable[]>(tablesKey)
      queryClient.setQueryData<FloorTable[]>(tablesKey, (current) =>
        current?.map((table) => (table.id === id ? { ...table, ...patch } : table)),
      )
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(tablesKey, context.previous)
    },
    onSettled: refresh,
  }))

  /**
   * Cambiar el tamaño puede sacar la mesa de la grilla, así que la posición se
   * recalcula junto con la huella nueva.
   */
  function resizeTable(table: FloorTable, span: { width: number; height: number }) {
    patchTable.mutate({
      id: table.id,
      patch: resizePlacement(table, span),
    })
  }

  /**
   * Mueve una mesa a un sector. Conservar su posición anterior la dejaría encima
   * de otra mesa del destino, así que entra en el primer hueco libre.
   */
  function placeInSection(table: FloorTable, targetSectionId: string | null) {
    if (!targetSectionId) {
      patchTable.mutate({ id: table.id, patch: { section_id: null } })
      return
    }
    const { x, y } = findFreeCell(tableFootprint(table), occupiedCells(targetSectionId, table.id))
    patchTable.mutate({
      id: table.id,
      patch: { section_id: targetSectionId, position_x: x, position_y: y },
    })
    setSelectedTableId(table.id)
  }

  /** Traduce una intención del inspector a la operación que le corresponde. */
  function applyIntent(table: FloorTable, intent: TableIntent) {
    switch (intent.kind) {
      case 'resize':
        return resizeTable(table, intent)
      case 'move-to-section':
        return placeInSection(table, intent.sectionId)
      case 'edit':
        return patchTable.mutate({ id: table.id, patch: intent.patch })
    }
  }

  function handleAddSection(event: FormEvent) {
    event.preventDefault()
    const name = newSectionName.trim()
    if (!name || !branchId) return
    addSection.mutate(name, { onSuccess: () => setNewSectionName('') })
  }

  function handleAddTable(event: FormEvent) {
    event.preventDefault()
    const label = newTableLabel.trim()
    if (!label || !branchId) return
    addTable.mutate(label, { onSuccess: () => setNewTableLabel('') })
  }

  function chooseSection(id: string) {
    setSectionChoice(id)
    setSelectedTableId(null)
  }

  if (branches.isLoading) return <Spinner />

  const editing = mode === 'edit'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Salón</h1>
          <p className="text-sm text-neutral-500">
            {editing
              ? 'Creá sectores, agregá mesas y ubicalas como están en la realidad.'
              : 'Así ve el salón el personal. Pasá a editar para cambiar el plano.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(branches.data?.length ?? 0) > 1 && (
            <Select
              className="w-56"
              value={branchId ?? ''}
              onChange={(event) => {
                setBranchChoice(event.target.value)
                setSectionChoice(null)
                setSelectedTableId(null)
              }}
              aria-label="Sucursal"
            >
              {branches.data?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
          <ModeSwitch
            mode={mode}
            onChange={(next) => {
              setMode(next)
              errors.clear()
              if (next === 'view') setSelectedTableId(null)
            }}
          />
        </div>
      </div>

      <ErrorText error={errors.message} />

      <SectionTabs
        sections={sections.data ?? []}
        activeId={sectionId}
        onChoose={chooseSection}
        tables={tables.data ?? []}
      />

      {editing && (
        <form onSubmit={handleAddSection} className="flex flex-wrap items-center gap-2">
          <Input
            className="w-56"
            value={newSectionName}
            onChange={(event) => setNewSectionName(event.target.value)}
            placeholder="Nuevo sector"
            aria-label="Nombre del nuevo sector"
          />
          <Button type="submit" disabled={!branchId || addSection.isPending}>
            <Plus size={16} />
            Agregar sector
          </Button>
        </form>
      )}

      {editing && section && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
          {renaming?.id === section.id ? (
            <RenameSectionForm
              section={section}
              onCancel={() => setRenaming(null)}
              onSave={(name) =>
                patchSection.mutate(
                  { id: section.id, patch: { name } },
                  { onSuccess: () => setRenaming(null) },
                )
              }
            />
          ) : (
            <>
              <span className="text-sm font-semibold text-neutral-900">{section.name}</span>
              <Button variant="ghost" onClick={() => setRenaming(section)}>
                <Pencil size={15} />
                Renombrar
              </Button>
            </>
          )}
          <Toggle
            checked={section.is_active}
            onChange={(is_active) => patchSection.mutate({ id: section.id, patch: { is_active } })}
            label="Sector en uso"
          />
          <button
            className="ml-auto cursor-pointer p-1 text-neutral-400 hover:text-red-600"
            aria-label="Eliminar sector"
            onClick={() => {
              if (
                confirm(
                  `¿Eliminar el sector "${section.name}"? Sus ${sectionTables.length} mesa(s) quedan sin sector, no se borran.`,
                )
              ) {
                removeSection.mutate(section.id, { onSuccess: () => setSectionChoice(null) })
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {sections.isLoading || tables.isLoading ? (
        <Spinner />
      ) : !sectionId ? (
        <EmptyState
          message={
            editing
              ? 'Creá el primer sector para empezar a dibujar el salón.'
              : 'Todavía no hay sectores. Pasá a editar para crear el primero.'
          }
        />
      ) : editing ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <form onSubmit={handleAddTable} className="flex flex-wrap gap-2">
              <Input
                className="w-56"
                value={newTableLabel}
                onChange={(event) => setNewTableLabel(event.target.value)}
                placeholder="Nueva mesa (ej: Mesa 5)"
                aria-label="Identificador de la nueva mesa"
              />
              <Button type="submit" disabled={addTable.isPending}>
                <Plus size={16} />
                Agregar al sector
              </Button>
            </form>

            <FloorCanvas
              tables={sectionTables}
              selectedId={selectedTableId}
              onSelect={setSelectedTableId}
              onMove={(id, x, y) => patchTable.mutate({ id, patch: { position_x: x, position_y: y } })}
              onResize={(id, width, height) => {
                const table = sectionTables.find((entry) => entry.id === id)
                if (table) resizeTable(table, { width, height })
              }}
              onReject={errors.report}
            />

            {unassigned.length > 0 && (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4">
                <h2 className="text-sm font-semibold text-neutral-700">Mesas sin sector</h2>
                <p className="mb-2 text-xs text-neutral-500">
                  Existen y tienen QR, pero no aparecen en ningún plano.
                </p>
                <ul className="flex flex-wrap gap-2">
                  {unassigned.map((table) => (
                    <li key={table.id}>
                      <Button variant="secondary" onClick={() => placeInSection(table, sectionId)}>
                        <LayoutGrid size={15} />
                        {table.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {selectedTable ? (
            <TableInspector
              table={selectedTable}
              sections={sections.data ?? []}
              busy={removeTable.isPending}
              onIntent={(intent) => applyIntent(selectedTable, intent)}
              onDelete={() =>
                removeTable.mutate(selectedTable.id, { onSuccess: () => setSelectedTableId(null) })
              }
            />
          ) : (
            <aside className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500">
              Tocá una mesa del plano para editar su identificador, capacidad, tamaño y visibilidad.
            </aside>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <SectionSummary tables={sectionTables} section={section} />
          <FloorCanvas
            tables={sectionTables}
            selectedId={selectedTableId}
            onSelect={setSelectedTableId}
          />
          {unassigned.length > 0 && (
            <p className="text-xs text-neutral-500">
              {unassigned.length} mesa(s) sin sector no aparecen en ningún plano. Pasá a editar para
              ubicarlas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: { id: Mode; label: string; icon: typeof Eye }[] = [
    { id: 'view', label: 'Visualizar', icon: Eye },
    { id: 'edit', label: 'Editar', icon: SquarePen },
  ]

  return (
    <div
      className="flex rounded-lg border border-neutral-200 bg-white p-1"
      role="group"
      aria-label="Modo del plano"
    >
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={mode === id}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
            mode === id ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
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
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
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

/** Lo que el encargado quiere saber del sector sin abrir cada mesa. */
function SectionSummary({ tables, section }: { tables: FloorTable[]; section: FloorSection | null }) {
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
      {section && !section.is_active && (
        <p className="self-center rounded-lg bg-amber-50 px-3 py-1 text-xs text-amber-900">
          Sector sin uso: el POS no ofrece ninguna de estas mesas.
        </p>
      )}
    </dl>
  )
}

function RenameSectionForm({
  section,
  onSave,
  onCancel,
}: {
  section: FloorSection
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(section.name)

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const next = name.trim()
        if (next) onSave(next)
      }}
    >
      <Input className="w-48" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      <Button type="submit" variant="secondary" aria-label="Guardar nombre">
        <Check size={15} />
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel} aria-label="Cancelar">
        <X size={15} />
      </Button>
    </form>
  )
}

import { useState } from 'react'
import { Check, LayoutGrid, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button, EmptyState, ErrorText, Input, Toggle } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable } from '@/queries/floor'
import { FloorCanvas } from './FloorCanvas'
import { TableInspector } from './TableInspector'
import type { Floor } from './useFloor'
import { useFloorEditor, type FloorEditorActions } from './useFloorEditor'

type FloorEditorProps = {
  branchId: string
  floor: Floor
  /** Sector abierto; `null` si la sucursal todavía no tiene ninguno. */
  section: FloorSection | null
}

/** El plano en modo editar: sectores, mesas, gestos e inspector. */
export function FloorEditor({ branchId, floor, section }: FloorEditorProps) {
  const editor = useFloorEditor(branchId, floor)

  return (
    <>
      <ErrorText error={editor.errors.message} />
      <AddForm
        label="Agregar sector"
        placeholder="Nuevo sector"
        ariaLabel="Nombre del nuevo sector"
        pending={editor.addSection.isPending}
        onAdd={(name, onSaved) => editor.addSection.mutate(name, { onSuccess: onSaved })}
      />
      {section ? (
        <SectionEditor section={section} floor={floor} editor={editor} />
      ) : (
        <EmptyState message="Creá el primer sector para empezar a dibujar el salón." />
      )}
    </>
  )
}

function SectionEditor({
  section,
  floor,
  editor,
}: {
  section: FloorSection
  floor: Floor
  editor: FloorEditorActions
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Se busca en todo el salón: una mesa mudada de sector desde el inspector
  // sigue abierta en él.
  const selected = floor.tables.find((table) => table.id === selectedId) ?? null
  const tables = floor.tablesIn(section.id)

  return (
    <>
      <SectionBar
        section={section}
        tableCount={tables.length}
        onRename={(name, onSaved) =>
          editor.patchSection.mutate({ id: section.id, patch: { name } }, { onSuccess: onSaved })
        }
        onActiveChange={(is_active) =>
          editor.patchSection.mutate({ id: section.id, patch: { is_active } })
        }
        // Sin reset a mano: cuando el sector deja de existir, la página abre el primero.
        onDelete={() => editor.removeSection.mutate(section.id)}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <AddForm
            label="Agregar al sector"
            placeholder="Nueva mesa (ej: Mesa 5)"
            ariaLabel="Identificador de la nueva mesa"
            pending={editor.addTable.isPending}
            onAdd={(label, onSaved) =>
              editor.addTable.mutate({ sectionId: section.id, label }, { onSuccess: onSaved })
            }
          />

          <FloorCanvas
            tables={tables}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={editor.moveTable}
            onResize={editor.resizeTable}
            onReject={editor.errors.report}
          />

          <UnassignedTables
            tables={floor.tablesIn(null)}
            onPlace={(table) => {
              editor.placeInSection(table, section.id)
              setSelectedId(table.id)
            }}
          />
        </div>

        {selected ? (
          <TableInspector
            // Otra mesa, otro inspector: un borrador a medio escribir no pasa de una a otra.
            key={selected.id}
            table={selected}
            sections={floor.sections}
            busy={editor.removeTable.isPending}
            onIntent={(intent) => editor.applyIntent(selected, intent)}
            onDelete={() =>
              editor.removeTable.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
            }
          />
        ) : (
          <aside className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500">
            Tocá una mesa del plano para editar su identificador, capacidad, tamaño y visibilidad.
          </aside>
        )}
      </div>
    </>
  )
}

/** Nombre, uso y borrado del sector abierto. */
function SectionBar({
  section,
  tableCount,
  onRename,
  onActiveChange,
  onDelete,
}: {
  section: FloorSection
  tableCount: number
  onRename: (name: string, onSaved: () => void) => void
  onActiveChange: (isActive: boolean) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
      {renaming ? (
        <RenameSectionForm
          section={section}
          onCancel={() => setRenaming(false)}
          onSave={(name) => onRename(name, () => setRenaming(false))}
        />
      ) : (
        <>
          <span className="text-sm font-semibold text-neutral-900">{section.name}</span>
          <Button variant="ghost" onClick={() => setRenaming(true)}>
            <Pencil size={15} />
            Renombrar
          </Button>
        </>
      )}
      <Toggle checked={section.is_active} onChange={onActiveChange} label="Sector en uso" />
      <button
        className="ml-auto cursor-pointer p-1 text-neutral-400 hover:text-red-600"
        aria-label="Eliminar sector"
        onClick={() => {
          if (
            confirm(
              `¿Eliminar el sector "${section.name}"? Sus ${tableCount} mesa(s) quedan sin sector, no se borran.`,
            )
          ) {
            onDelete()
          }
        }}
      >
        <Trash2 size={16} />
      </button>
    </div>
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

/** Un campo y un botón para crear algo por nombre. Se vacía solo si se guardó. */
function AddForm({
  label,
  placeholder,
  ariaLabel,
  pending,
  onAdd,
}: {
  label: string
  placeholder: string
  ariaLabel: string
  pending: boolean
  onAdd: (name: string, onSaved: () => void) => void
}) {
  const [name, setName] = useState('')

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed) onAdd(trimmed, () => setName(''))
      }}
    >
      <Input
        className="w-56"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <Button type="submit" disabled={pending}>
        <Plus size={16} />
        {label}
      </Button>
    </form>
  )
}

function UnassignedTables({
  tables,
  onPlace,
}: {
  tables: FloorTable[]
  onPlace: (table: FloorTable) => void
}) {
  if (tables.length === 0) return null

  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Mesas sin sector</h2>
      <p className="mb-2 text-xs text-neutral-500">
        Existen y tienen QR, pero no aparecen en ningún plano.
      </p>
      <ul className="flex flex-wrap gap-2">
        {tables.map((table) => (
          <li key={table.id}>
            <Button variant="secondary" onClick={() => onPlace(table)}>
              <LayoutGrid size={15} />
              {table.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

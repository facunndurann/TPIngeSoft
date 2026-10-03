import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronRight, Ellipsis, Pencil, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Toggle,
  iconButtonClass,
  keyBelongsElsewhere,
  useConfirm,
  useFloorCamera,
} from '@restaurant-platform/ui'
import { countLabel } from '@restaurant-platform/shared'
import { UnsavedChangesGuard } from '@/features/UnsavedChangesGuard'
import type { FloorSection, FloorTable } from '@/queries/floor'
import { FloorCanvas } from './FloorCanvas'
import { FloorHeader, FloorLayout } from './FloorLayout'
import { NewSectionButton, SectionTabs } from './SectionTabs'
import { SectionTables } from './SectionTables'
import { TableInspector } from './TableInspector'
import { FloorLegend } from './TableTile'
import { sectionOf, type FloorScreenProps } from './floor'
import { useFloorEditor, type FloorEditorActions } from './useFloorEditor'

/**
 * El plano en modo editar: sectores, mesas, gestos y el panel de la mesa elegida.
 * Todo cambia un borrador (`useFloorEditor`), que nadie más ve: «Guardar» lo
 * escribe de una vez y vuelve a la vista, y «Cancelar» lo descarta.
 */
export function FloorEditor({ branchId, floor: saved, sectionId, onChooseSection, onSwitchMode }: FloorScreenProps) {
  const editor = useFloorEditor(branchId, saved)
  const section = sectionOf(editor.floor, sectionId)
  const { confirm, dialog } = useConfirm()

  async function cancel() {
    if (editor.dirty) {
      const discard = await confirm({
        title: '¿Descartar los cambios?',
        message: 'Lo que cambiaste en el salón no se guarda.',
        confirmLabel: 'Descartar cambios',
      })
      if (!discard) return
    }
    onSwitchMode()
  }

  return (
    <>
      {/* Salir del Salón o recargar con cambios sin guardar también pregunta. */}
      <UnsavedChangesGuard when={editor.dirty} />
      <FloorHeader
        sections={
          <SectionTabs floor={editor.floor} activeId={section?.id ?? null} onChoose={onChooseSection}>
            {/* Un sector nuevo se abre apenas se crea: es para dibujarlo. */}
            <NewSectionButton
              onAdd={(name) => {
                const id = editor.addSection(name)
                if (id) onChooseSection(id)
                return id !== null
              }}
            />
          </SectionTabs>
        }
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              shape="pill"
              disabled={editor.save.isPending}
              onClick={() => void cancel()}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="touch"
              shape="pill"
              disabled={!editor.dirty || editor.save.isPending}
              onClick={() => editor.save.mutate(undefined, { onSuccess: onSwitchMode })}
            >
              <Check size={16} aria-hidden="true" />
              {editor.save.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      />
      {section ? (
        // Otro sector, otra pantalla: la mesa elegida y la cámara no pasan de uno a
        // otro. El borrador sí, porque es de toda la sucursal.
        <SectionEditor key={section.id} section={section} editor={editor} />
      ) : (
        <EmptyState message="Creá el primer sector para empezar a dibujar el salón." />
      )}
      {dialog}
    </>
  )
}

function SectionEditor({ section, editor }: { section: FloorSection; editor: FloorEditorActions }) {
  const { floor } = editor
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Se busca en todo el salón y no solo en el sector: una mesa sin sector que se
  // trae a este queda elegida antes de que su sector nuevo se vea en el plano.
  const selected = floor.tables.find((table) => table.id === selectedId) ?? null
  const tables = floor.tablesIn(section.id)
  const { confirm, dialog } = useConfirm()
  const { removeTable } = editor
  // Lo nuevo (una mesa, una mesa sin sector que se trae) aparece donde se está
  // mirando: por eso la cámara es de acá y no del plano.
  const camera = useFloorCamera(tables)

  /** Lo mismo desde el botón del panel que desde el teclado: borrar se pregunta siempre. */
  const confirmDelete = useCallback(
    async (table: FloorTable) => {
      const confirmed = await confirm({
        title: `¿Eliminar "${table.label}"?`,
        message: 'Se pierde su QR: el que está impreso en la mesa deja de funcionar.',
        confirmLabel: 'Eliminar mesa',
      })
      if (!confirmed) return
      removeTable(table.id)
      setSelectedId(null)
    },
    [confirm, removeTable],
  )

  // Suprimir, o ⌫ en una Mac, con una mesa elegida pide borrarla. No si se está
  // escribiendo en un campo (ahí borra una letra) ni con un diálogo abierto.
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || keyBelongsElsewhere(event.target)) return
      event.preventDefault()
      void confirmDelete(selected)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selected, confirmDelete])

  return (
    <>
      <FloorLayout
        plan={
          <>
            <FloorCanvas
              tables={tables}
              camera={camera}
              editing={{
                selectedId,
                onSelect: setSelectedId,
                onPlace: editor.placeTable,
                refusal: editor.refusal,
                onRefusalShown: editor.dismissRefusal,
              }}
              toolbar={
                <SectionToolbar
                  section={section}
                  tableCount={tables.length}
                  // La mesa nueva queda elegida: lo próximo es ponerle nombre y lugares.
                  onAddTable={() => setSelectedId(editor.addTable(section.id, camera.centerCell()))}
                  onRename={(name) => editor.renameSection(section.id, name)}
                  onActiveChange={(isActive) => editor.setSectionActive(section.id, isActive)}
                  // Sin reset a mano: cuando el sector deja de existir, la pantalla abre el primero.
                  onDelete={() => editor.removeSection(section.id)}
                />
              }
              footerStart={<UndoRedo editor={editor} />}
            />
            <FloorLegend editing />
          </>
        }
        panel={
          selected ? (
            <TableInspector
              // Otra mesa, otro panel: un borrador a medio escribir no pasa de una a otra.
              key={selected.id}
              table={selected}
              sectionName={floor.sections.find((entry) => entry.id === selected.section_id)?.name ?? 'Sin sector'}
              onEdit={(edit) => editor.editTable(selected, edit)}
              onPlace={(placed) => {
                editor.placeTable(selected, placed)
                // Que se vea adónde fue, aunque haya salido del recuadro.
                camera.reveal(placed)
              }}
              onClose={() => setSelectedId(null)}
              onDelete={() => void confirmDelete(selected)}
            />
          ) : (
            <SectionTables
              tables={tables}
              onChoose={(table) => setSelectedId(table.id)}
              chooseIcon={ChevronRight}
              empty="Todavía no hay mesas. Agregá la primera desde el plano."
            >
              <UnassignedTables
                tables={floor.tablesIn(null)}
                onPlace={(table) => {
                  editor.placeInSection(table, section.id, camera.centerCell())
                  setSelectedId(table.id)
                }}
              />
            </SectionTables>
          )
        }
      />
      {dialog}
    </>
  )
}

/** Barra de arriba del plano: agregar mesas, y el nombre, el uso y el borrado del sector. */
function SectionToolbar({
  section,
  tableCount,
  onAddTable,
  onRename,
  onActiveChange,
  onDelete,
}: {
  section: FloorSection
  tableCount: number
  onAddTable: () => void
  /** Devuelve si se renombró: no, si otro sector ya se llama así. */
  onRename: (name: string) => boolean
  onActiveChange: (isActive: boolean) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const { confirm, dialog } = useConfirm()

  async function confirmDelete() {
    const confirmed = await confirm({
      title: `¿Eliminar el sector "${section.name}"?`,
      message:
        tableCount === 0
          ? 'El sector no tiene mesas.'
          : `${countLabel(tableCount, 'mesa queda', 'mesas quedan')} sin sector. No se borran.`,
      confirmLabel: 'Eliminar sector',
    })
    if (confirmed) onDelete()
  }

  return (
    <>
      {renaming ? (
        <RenameSectionForm
          section={section}
          onCancel={() => setRenaming(false)}
          onSave={(name) => {
            if (onRename(name)) setRenaming(false)
          }}
        />
      ) : (
        <Button type="button" size="touch" shape="pill" onClick={onAddTable}>
          <Plus size={18} aria-hidden="true" />
          Agregar mesa
        </Button>
      )}
      <div className="flex items-center gap-3">
        <Toggle checked={section.is_active} onChange={onActiveChange} label="Sector en uso" />
        <SectionMenu sectionName={section.name} onRename={() => setRenaming(true)} onDelete={confirmDelete} />
      </div>
      {dialog}
    </>
  )
}

/**
 * Las acciones del sector que se usan poco, detrás de «⋯». Es un desplegable de
 * botones comunes y no un `role="menu"`: se recorre con Tab, sin flechas que
 * aprender. Se cierra con Escape, al elegir algo o al tocar afuera.
 */
function SectionMenu({
  sectionName,
  onRename,
  onDelete,
}: {
  sectionName: string
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  // Safari no enfoca un botón al tocarlo, así que perder el foco no alcanza
  // para saber que se tocó afuera.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  const itemClass =
    'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors'

  return (
    <div
      ref={wrapper}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false)
          toggle.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={iconButtonClass({ size: 'touch', shape: 'pill' })}
        aria-label={`Opciones del sector ${sectionName}`}
        title="Opciones del sector"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg"
        >
          <button type="button" className={`${itemClass} text-neutral-700 hover:bg-neutral-50`} onClick={choose(onRename)}>
            <Pencil size={16} aria-hidden="true" />
            Renombrar
          </button>
          <button type="button" className={`${itemClass} text-red-700 hover:bg-red-50`} onClick={choose(onDelete)}>
            <Trash2 size={16} aria-hidden="true" />
            Eliminar sector
          </button>
        </div>
      )}
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
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <Input
        size="touch"
        className="w-48"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={`Nuevo nombre de ${section.name}`}
        autoFocus
      />
      <button
        type="submit"
        className={iconButtonClass({ size: 'touch', shape: 'pill', variant: 'secondary' })}
        aria-label="Guardar nombre"
        title="Guardar nombre"
      >
        <Check size={18} aria-hidden="true" />
      </button>
      <IconButton label="Cancelar" size="touch" shape="pill" variant="secondary" onClick={onCancel}>
        <X size={18} aria-hidden="true" />
      </IconButton>
    </form>
  )
}

/** Deshacer y rehacer lo que se cambió en esta edición, sin guardar todavía. */
function UndoRedo({ editor }: { editor: FloorEditorActions }) {
  const buttonClass =
    'inline-flex h-11 w-12 cursor-pointer items-center justify-center bg-white text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-white'

  return (
    <div className="flex items-center overflow-hidden rounded-full border border-neutral-200" role="group" aria-label="Historial de cambios">
      <button type="button" className={buttonClass} aria-label="Deshacer" title="Deshacer" disabled={!editor.canUndo} onClick={editor.undo}>
        <Undo2 size={18} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="h-6 w-px bg-neutral-200" />
      <button type="button" className={buttonClass} aria-label="Rehacer" title="Rehacer" disabled={!editor.canRedo} onClick={editor.redo}>
        <Redo2 size={18} aria-hidden="true" />
      </button>
    </div>
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
    <div className="mt-1 border-t border-neutral-200 px-2 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">Mesas sin sector</h3>
      <ul className="flex flex-wrap gap-2">
        {tables.map((table) => (
          <li key={table.id}>
            <Button type="button" variant="secondary" size="touch" shape="pill" onClick={() => onPlace(table)}>
              <Plus size={16} aria-hidden="true" />
              {table.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

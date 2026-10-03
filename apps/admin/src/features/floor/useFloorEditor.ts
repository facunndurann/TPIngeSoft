import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  findFreeCell,
  occupiedBy,
  tableFootprint,
  tablePlacement,
  type Footprint,
  type Placed,
  type TableSpan,
} from '@restaurant-platform/shared'
import { errorMessage, useToast } from '@restaurant-platform/ui'
import { floorKey, saveFloor, type FloorTable, type TablePatch } from '@/queries/floor'
import { useRestaurant } from '@/restaurant/restaurant-context'
import type { TableEdit } from './TableInspector'
import { floorOf, nextTableLabel, type Floor } from './floor'
import {
  floorChanges,
  hasChanges,
  patchSection,
  patchTable,
  withSection,
  withTable,
  withoutSection,
  withoutTable,
  type FloorDraft,
} from './floorDraft'
import { OVERLAP_MESSAGE, changesTo, fitsAt, type Refusal } from './placement'

const SAVE_FAILED = 'No pudimos guardar los cambios del salón.'

/** Tamaño de una mesa nueva, en celdas. */
const NEW_TABLE_SPAN: TableSpan = { width: 3, height: 3 }

/** Una celda del plano, con decimales: el centro de lo que se está mirando. */
type Cell = { x: number; y: number }

/**
 * Esquina de arriba a la izquierda para que una mesa de ese tamaño quede
 * centrada en `center`. Sin centro, el origen del plano.
 */
const cornerAround = (footprint: Footprint, center?: Cell) =>
  center ? { x: center.x - footprint.w / 2, y: center.y - footprint.h / 2 } : undefined

/** Cuántos cambios se pueden deshacer. */
const HISTORY_LIMIT = 50

/** El borrador y lo que se puede deshacer y rehacer de él. */
type History = { past: FloorDraft[]; present: FloorDraft; future: FloorDraft[] }

export type FloorEditorActions = ReturnType<typeof useFloorEditor>

/**
 * Una edición del Salón de una sucursal. Arranca con el salón como estaba al
 * entrar a editar, y todo lo que se hace cambia un borrador: el POS y la base no
 * ven nada hasta guardar (`save`), que escribe todo junto. Salir sin guardar lo
 * descarta. Deshacer y rehacer recorren el borrador, sectores incluidos.
 */
export function useFloorEditor(branchId: string, initial: Floor) {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const toast = useToast()
  // Lo que había al entrar: contra eso se calcula qué guardar. Si el salón se
  // relee mientras tanto, el borrador no cambia.
  const [base] = useState<FloorDraft>(() => ({ sections: initial.sections, tables: initial.tables }))
  const [history, setHistory] = useState<History>(() => ({ past: [], present: base, future: [] }))
  /** La última mesa que no entró, hasta que el plano termina de marcarla. */
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  const draft = history.present
  const floor = floorOf(draft.sections, draft.tables)
  const changes = floorChanges(base, draft)

  /**
   * Los errores del plano salen como aviso flotante: un recuadro arriba del plano
   * corría toda la pantalla cada vez que una mesa no entraba donde se la soltó.
   */
  const reportError = (message: string) => toast(message, { tone: 'error' })

  /** Un cambio más al borrador: se puede deshacer, y lo que se había deshecho ya no se rehace. */
  function commit(next: FloorDraft) {
    setHistory((current) => ({
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: next,
      future: [],
    }))
  }

  function undo() {
    setHistory((current) =>
      current.past.length === 0
        ? current
        : {
            past: current.past.slice(0, -1),
            present: current.past[current.past.length - 1],
            future: [current.present, ...current.future],
          },
    )
  }

  function redo() {
    setHistory((current) =>
      current.future.length === 0
        ? current
        : { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) },
    )
  }

  // Se relee el salón antes de salir del editor: la vista abre con lo guardado.
  const save = useMutation({
    mutationFn: () => saveFloor(branchId, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floorKey(branchId) }),
    onError: (error) => reportError(errorMessage(error, SAVE_FAILED)),
  })

  /** Si otro sector, que no sea `exceptId`, ya se llama así: la base no deja repetir nombres en una sucursal. */
  function sectionNameTaken(name: string, exceptId?: string) {
    const taken = draft.sections.some((section) => section.name === name && section.id !== exceptId)
    if (taken) reportError('Ya hay un sector con ese nombre.')
    return taken
  }

  /** Crea un sector al final de la fila y devuelve su id, para abrirlo; `null` si el nombre ya existe. */
  function addSection(name: string) {
    if (sectionNameTaken(name)) return null
    const id = crypto.randomUUID()
    commit(
      withSection(draft, {
        id,
        restaurant_id: restaurant.id,
        branch_id: branchId,
        name,
        sort_order: draft.sections.length,
        is_active: true,
        created_at: new Date().toISOString(),
      }),
    )
    return id
  }

  /** Devuelve si se pudo: no, si otro sector ya se llama así. */
  function renameSection(id: string, name: string) {
    if (sectionNameTaken(name, id)) return false
    commit(patchSection(draft, id, { name }))
    return true
  }

  const setSectionActive = (id: string, isActive: boolean) => commit(patchSection(draft, id, { is_active: isActive }))

  const removeSection = (id: string) => commit(withoutSection(draft, id))

  /**
   * Una mesa nueva entra en el hueco libre más cercano a lo que se está mirando
   * (`near`, el centro del recuadro) y con el próximo «Mesa N»: el nombre se
   * cambia después en el panel, como todo lo demás. Devuelve su id, para elegirla.
   */
  function addTable(sectionId: string, near?: Cell) {
    const footprint = tableFootprint(NEW_TABLE_SPAN)
    const { x, y } = findFreeCell(footprint, occupiedBy(floor.tablesIn(sectionId)), cornerAround(footprint, near))
    const id = crypto.randomUUID()
    commit(
      withTable(draft, {
        id,
        restaurant_id: restaurant.id,
        branch_id: branchId,
        section_id: sectionId,
        label: nextTableLabel(draft.tables),
        position_x: x,
        position_y: y,
        ...NEW_TABLE_SPAN,
        seats: 4,
        shape: 'rect',
        is_active: true,
        is_visible: true,
        // El QR lo pone la base al guardar; el editor no lo muestra.
        qr_token: '',
        created_at: new Date().toISOString(),
      }),
    )
    return id
  }

  const removeTable = (id: string) => commit(withoutTable(draft, id))

  /**
   * Si la mesa, con estos cambios, queda en un lugar libre de su sector; si no,
   * avisa. Es la única validación de dónde puede ir una mesa: pasan por acá
   * soltarla, las flechas y el panel. Una mesa sin sector no está en ningún
   * plano, así que no choca con nada.
   */
  function roomFor(table: FloorTable, changes: TablePatch) {
    const next = { ...table, ...changes }
    if (!next.section_id || fitsAt(table, tablePlacement(next), floor.tablesIn(next.section_id))) return true
    // El aviso explica por qué, y lo anuncia el lector de pantalla; la marca en la
    // mesa dice cuál, donde se la estaba mirando.
    reportError(OVERLAP_MESSAGE)
    setRefusal((current) => ({ tableId: table.id, key: (current?.key ?? 0) + 1 }))
    return false
  }

  /**
   * Lleva una mesa a otro lugar o tamaño: lo que propone el plano al soltarla y
   * con las flechas. Moverla y estirarla son lo mismo, una caja nueva; se anota
   * solo lo que cambió, y nada si pisaría a otra.
   */
  function placeTable(table: FloorTable, placed: Placed) {
    const changes = changesTo(table, placed)
    if (changes && roomFor(table, changes)) commit(patchTable(draft, table.id, changes))
  }

  /**
   * Trae una mesa sin sector a este. Conservar su posición anterior la dejaría
   * encima de otra mesa, así que entra en el hueco libre más cercano a `near`.
   */
  function placeInSection(table: FloorTable, sectionId: string, near?: Cell) {
    const footprint = tableFootprint(table)
    const { x, y } = findFreeCell(footprint, occupiedBy(floor.tablesIn(sectionId), table.id), cornerAround(footprint, near))
    commit(patchTable(draft, table.id, { section_id: sectionId, position_x: x, position_y: y }))
  }

  /** Lo que se cambia desde el panel: nombre, lugares, forma y uso. El nombre no se repite en la sucursal. */
  function editTable(table: FloorTable, edit: TableEdit) {
    if (edit.label !== undefined && draft.tables.some((entry) => entry.label === edit.label && entry.id !== table.id)) {
      reportError('Ya hay una mesa con ese nombre.')
      return
    }
    commit(patchTable(draft, table.id, edit))
  }

  return {
    /** El salón como queda con lo editado hasta ahora. */
    floor,
    addSection,
    renameSection,
    setSectionActive,
    removeSection,
    addTable,
    removeTable,
    placeTable,
    placeInSection,
    editTable,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    refusal,
    dismissRefusal: () => setRefusal(null),
    /** Si hay algo sin guardar. */
    dirty: hasChanges(changes),
    save,
  }
}

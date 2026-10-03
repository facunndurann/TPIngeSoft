import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collidesWithAny,
  findFreeCell,
  occupiedBy,
  tableFootprint,
  tablePlacement,
  type Footprint,
  type TableSpan,
} from '@restaurant-platform/shared'
import { useSaveErrors, useToast } from '@restaurant-platform/ui'
import {
  createSection,
  createTable,
  deleteSection,
  deleteTable,
  floorKey,
  tablesQuery,
  updateSection,
  updateTable,
  type FloorTable,
  type SectionPatch,
  type TablePatch,
} from '@/queries/floor'
import { optimistic, patchRow } from '@/lib/optimistic'
import { useRestaurant } from '@/restaurant/restaurant-context'
import type { TableBox } from './FloorCanvas'
import type { TableEdit } from './TableInspector'
import { nextTableLabel, type Floor } from './floor'
import { OVERLAP_MESSAGE } from './placement'

const SAVE_FAILED = 'No pudimos guardar el cambio.'

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

/** Un cambio guardado de una mesa: lo que tenía antes y lo que se le escribió. */
type TableChange = { id: string; before: TablePatch; after: TablePatch }

type History = { done: TableChange[]; undone: TableChange[] }

export type FloorEditorActions = ReturnType<typeof useFloorEditor>

/** Los valores actuales de la mesa en las columnas que toca `patch`. */
function snapshot(table: FloorTable, patch: TablePatch): TablePatch {
  return Object.fromEntries(
    Object.keys(patch).map((key) => [key, table[key as keyof TablePatch]]),
  ) as TablePatch
}

/**
 * Las escrituras del plano. Solo las usa el editor; sus errores salen como
 * aviso flotante. El historial de deshacer vive lo que vive él: es del sector
 * abierto mientras se lo edita.
 */
export function useFloorEditor(branchId: string, floor: Floor) {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const toast = useToast()
  // Los errores del plano salen como aviso flotante: un recuadro arriba del plano
  // corría toda la pantalla cada vez que una mesa no entraba donde se la soltó.
  const notify = useCallback((message: string) => toast(message, { tone: 'error' }), [toast])
  const errors = useSaveErrors({ notify })
  const tablesKey = tablesQuery(branchId).queryKey
  const [history, setHistory] = useState<History>({ done: [], undone: [] })

  /** Sectores y mesas juntos: borrar un sector también cambia sus mesas. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: floorKey(branchId) })
  }

  /** Toda mutación del plano falla igual: limpia, guarda y reporta. */
  const run = <TData, TArgs>(mutationFn: (args: TArgs) => Promise<TData>) =>
    errors.saving(SAVE_FAILED, { mutationFn, onSuccess: refresh })

  const addSection = useMutation(
    run((name: string) =>
      createSection({
        restaurant_id: restaurant.id,
        branch_id: branchId,
        name,
        sort_order: floor.sections.length,
      }),
    ),
  )
  const patchSection = useMutation(
    run(({ id, patch }: { id: string; patch: SectionPatch }) => updateSection(id, patch)),
  )
  const removeSection = useMutation(run((id: string) => deleteSection(id)))

  /**
   * Una mesa nueva entra en el hueco libre más cercano a lo que se está mirando
   * (`near`, el centro del recuadro) y con el próximo «Mesa N»: el nombre se
   * cambia después en el panel, como todo lo demás.
   */
  const addTable = useMutation(
    run(({ sectionId, near }: { sectionId: string; near?: Cell }) => {
      const footprint = tableFootprint(NEW_TABLE_SPAN)
      const { x, y } = findFreeCell(footprint, occupiedBy(floor.tablesIn(sectionId)), cornerAround(footprint, near))
      // Se guarda con el mismo tamaño con el que se buscó el hueco.
      return createTable({
        restaurant_id: restaurant.id,
        branch_id: branchId,
        section_id: sectionId,
        label: nextTableLabel(floor.tables),
        position_x: x,
        position_y: y,
        ...NEW_TABLE_SPAN,
      })
    }),
  )

  // Una mesa borrada sale del historial: no hay nada que devolverle.
  const removeTable = useMutation(
    errors.saving(SAVE_FAILED, {
      mutationFn: (id: string) => deleteTable(id),
      onSuccess: (_data, id) => {
        refresh()
        const keep = (change: TableChange) => change.id !== id
        setHistory((current) => ({ done: current.done.filter(keep), undone: current.undone.filter(keep) }))
      },
    }),
  )

  const patchTable = useMutation(errors.saving(SAVE_FAILED, {
    mutationFn: ({ id, patch }: { id: string; patch: TablePatch }) => updateTable(id, patch),
    // Optimista: al soltar una mesa tiene que quedar donde la soltaste, no
    // saltar a la posición vieja hasta que vuelva el refetch.
    ...optimistic(queryClient, tablesKey, (tables, { id, patch }: { id: string; patch: TablePatch }) =>
      patchRow(tables, { id, ...patch }),
    ),
  }))

  /**
   * Escribe y, si se guardó, lo anota para deshacer. Se anota al guardarse y no
   * al pedirlo: un cambio que falló ya volvió atrás solo y no hay que deshacerlo.
   */
  function patch(id: string, changes: TablePatch) {
    const table = floor.tables.find((entry) => entry.id === id)
    patchTable.mutate(
      { id, patch: changes },
      {
        onSuccess: () => {
          if (!table) return
          const change = { id, before: snapshot(table, changes), after: changes }
          setHistory((current) => ({ done: [...current.done, change].slice(-HISTORY_LIMIT), undone: [] }))
        },
      },
    )
  }

  /**
   * Vuelve a escribir un estado anterior (o posterior) de una mesa sin anotarlo.
   * Si mientras tanto otra mesa ocupó ese lugar, no lo pisa: avisa y no hace nada.
   */
  function restore(id: string, values: TablePatch) {
    const table = floor.tables.find((entry) => entry.id === id)
    if (!table) return false
    const next = { ...table, ...values }
    if (next.section_id && collidesWithAny(tablePlacement(next), occupiedBy(floor.tablesIn(next.section_id), id))) {
      errors.report(OVERLAP_MESSAGE)
      return false
    }
    patchTable.mutate({ id, patch: values })
    return true
  }

  function undo() {
    const change = history.done[history.done.length - 1]
    if (!change || !restore(change.id, change.before)) return
    setHistory((current) => ({ done: current.done.slice(0, -1), undone: [...current.undone, change] }))
  }

  function redo() {
    const change = history.undone[history.undone.length - 1]
    if (!change || !restore(change.id, change.after)) return
    setHistory((current) => ({ done: [...current.done, change], undone: current.undone.slice(0, -1) }))
  }

  function moveTable(tableId: string, x: number, y: number) {
    patch(tableId, { position_x: x, position_y: y })
  }

  /**
   * Estirar desde una esquina del plano, o con Mayús y las flechas. Se escribe
   * solo lo que cambió: dos teclas seguidas llegan antes de que la primera se vea,
   * y mandar la caja entera dejaba el ancho de la primera pisado por el viejo.
   */
  function reshapeTable(table: FloorTable, box: TableBox) {
    const now = tablePlacement(table)
    const changes: TablePatch = {}
    if (box.x !== now.x) changes.position_x = box.x
    if (box.y !== now.y) changes.position_y = box.y
    if (box.width !== now.footprint.w) changes.width = box.width
    if (box.height !== now.footprint.h) changes.height = box.height
    if (Object.keys(changes).length > 0) patch(table.id, changes)
  }

  /**
   * Trae una mesa sin sector a este. Conservar su posición anterior la dejaría
   * encima de otra mesa, así que entra en el hueco libre más cercano a `near`.
   */
  function placeInSection(table: FloorTable, sectionId: string, near?: Cell) {
    const footprint = tableFootprint(table)
    const { x, y } = findFreeCell(footprint, occupiedBy(floor.tablesIn(sectionId), table.id), cornerAround(footprint, near))
    patch(table.id, { section_id: sectionId, position_x: x, position_y: y })
  }

  /** Lo que se cambia desde el panel: nombre, lugares, forma y uso. */
  function editTable(table: FloorTable, edit: TableEdit) {
    patch(table.id, edit)
  }

  return {
    errors,
    addSection,
    patchSection,
    removeSection,
    addTable,
    removeTable,
    moveTable,
    reshapeTable,
    placeInSection,
    editTable,
    undo,
    redo,
    canUndo: history.done.length > 0,
    canRedo: history.undone.length > 0,
  }
}

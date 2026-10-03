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
import {
  createSection,
  createTable,
  deleteSection,
  deleteTable,
  floorKey,
  tablePatchColumns,
  tablesQuery,
  updateSection,
  updateTable,
  type FloorTable,
  type SectionPatch,
  type TablePatch,
} from '@/queries/floor'
import { optimistic, patchRow } from '@/lib/optimistic'
import { useRestaurant } from '@/restaurant/restaurant-context'
import type { TableEdit } from './TableInspector'
import { nextTableLabel, type Floor } from './floor'
import { OVERLAP_MESSAGE, changesTo, fitsAt } from './placement'

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

/** Una escritura de una mesa: qué columnas cambian y a qué. */
type TableWrite = { id: string; patch: TablePatch }

export type FloorEditorActions = ReturnType<typeof useFloorEditor>

/** Las propiedades `keys` de `source`, con sus tipos. */
function pick<T, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {}
  for (const key of keys) picked[key] = source[key]
  return picked
}

/** Los valores actuales de la mesa en las columnas que toca `patch`: lo que deshacer vuelve a escribir. */
function snapshot(table: FloorTable, patch: TablePatch): TablePatch {
  return pick(table, tablePatchColumns.filter((column) => column in patch))
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
  const tablesKey = tablesQuery(branchId).queryKey
  const [history, setHistory] = useState<History>({ done: [], undone: [] })

  /** Sectores y mesas juntos: borrar un sector también cambia sus mesas. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: floorKey(branchId) })
  }

  /**
   * Los errores del plano salen como aviso flotante: un recuadro arriba del plano
   * corría toda la pantalla cada vez que una mesa no entraba donde se la soltó.
   */
  const reportError = (message: string) => toast(message, { tone: 'error' })

  /** Una escritura que falló: el mensaje del catálogo si lo trae, o el genérico. */
  const reportFailure = (error: Error) => reportError(errorMessage(error, SAVE_FAILED))

  /** Casi toda escritura del plano: si se guardó, relee el salón; si falló, avisa. */
  const run = <TData, TArgs>(mutationFn: (args: TArgs) => Promise<TData>) => ({
    mutationFn,
    onSuccess: refresh,
    onError: reportFailure,
  })

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

  const removeTable = useMutation({
    ...run((id: string) => deleteTable(id)),
    // Además de releer el salón, una mesa borrada sale del historial: no hay nada
    // que devolverle.
    onSuccess: (_data: void, id: string) => {
      refresh()
      const keep = (change: TableChange) => change.id !== id
      setHistory((current) => ({ done: current.done.filter(keep), undone: current.undone.filter(keep) }))
    },
  })

  // Optimista: al soltar una mesa tiene que quedar donde la soltaste, no saltar
  // a la posición vieja hasta que vuelva el refetch.
  const tablesCache = optimistic(queryClient, tablesKey, (tables, { id, patch }: TableWrite) =>
    patchRow(tables, { id, ...patch }),
  )
  const patchTable = useMutation({
    ...tablesCache,
    mutationFn: ({ id, patch }: TableWrite) => updateTable(id, patch),
    onError: (error, write, cached) => {
      // Primero la mesa vuelve a donde estaba; después se avisa por qué.
      tablesCache.onError(error, write, cached)
      reportFailure(error)
    },
  })

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
   * Si la mesa, con estos cambios, queda en un lugar libre de su sector; si no,
   * avisa. Es la única validación de dónde puede ir una mesa: pasan por acá
   * soltarla, las flechas, deshacer y rehacer. Una mesa sin sector no está en
   * ningún plano, así que no choca con nada.
   */
  function roomFor(table: FloorTable, changes: TablePatch) {
    const next = { ...table, ...changes }
    if (!next.section_id || fitsAt(table, tablePlacement(next), floor.tablesIn(next.section_id))) return true
    reportError(OVERLAP_MESSAGE)
    return false
  }

  /**
   * Vuelve a escribir un estado anterior (o posterior) de una mesa sin anotarlo.
   * Si mientras tanto otra mesa ocupó ese lugar, no lo pisa: avisa y no hace nada.
   */
  function restore(id: string, values: TablePatch) {
    const table = floor.tables.find((entry) => entry.id === id)
    if (!table || !roomFor(table, values)) return false
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

  /**
   * Lleva una mesa a otro lugar o tamaño: lo que propone el plano al soltarla y
   * con las flechas. Moverla y estirarla son lo mismo, una caja nueva; se escribe
   * solo lo que cambió, y nada si pisaría a otra.
   */
  function placeTable(table: FloorTable, placed: Placed) {
    const changes = changesTo(table, placed)
    if (changes && roomFor(table, changes)) patch(table.id, changes)
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
    addSection,
    patchSection,
    removeSection,
    addTable,
    removeTable,
    placeTable,
    placeInSection,
    editTable,
    undo,
    redo,
    canUndo: history.done.length > 0,
    canRedo: history.undone.length > 0,
  }
}

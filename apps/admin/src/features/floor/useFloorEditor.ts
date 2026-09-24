import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  findFreeCell,
  occupiedBy,
  resizePlacement,
  tableFootprint,
  type TableSpan,
} from '@restaurant-platform/shared'
import { useSaveErrors } from '@restaurant-platform/ui'
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
import { useRestaurant } from '@/restaurant/restaurant-context'
import type { TableIntent } from './TableInspector'
import type { Floor } from './useFloor'

const SAVE_FAILED = 'No pudimos guardar el cambio.'

/** Tamaño de una mesa nueva, en celdas. */
const NEW_TABLE_SPAN: TableSpan = { width: 3, height: 3 }

export type FloorEditorActions = ReturnType<typeof useFloorEditor>

/**
 * Las escrituras del plano. Solo las usa el editor, y su lugar de error vive lo
 * que vive él: salir de editar lo descarta sin que nadie lo limpie.
 */
export function useFloorEditor(branchId: string, floor: Floor) {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const errors = useSaveErrors()
  const tablesKey = tablesQuery(branchId).queryKey

  /** Sectores y mesas juntos: borrar un sector también cambia sus mesas. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: floorKey(branchId) })
  }

  /** Toda mutación del plano falla igual: limpia, guarda y reporta. */
  const run = <TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) =>
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

  const addTable = useMutation(
    run(({ sectionId, label }: { sectionId: string; label: string }) => {
      const { x, y } = findFreeCell(
        tableFootprint(NEW_TABLE_SPAN),
        occupiedBy(floor.tablesIn(sectionId)),
      )
      // Se guarda con el mismo tamaño con el que se buscó el hueco.
      return createTable({
        restaurant_id: restaurant.id,
        branch_id: branchId,
        section_id: sectionId,
        label,
        position_x: x,
        position_y: y,
        ...NEW_TABLE_SPAN,
      })
    }),
  )
  const removeTable = useMutation(run((id: string) => deleteTable(id)))

  const patchTable = useMutation(errors.saving(SAVE_FAILED, {
    mutationFn: ({ id, patch }: { id: string; patch: TablePatch }) => updateTable(id, patch),
    // Optimista: al soltar una mesa tiene que quedar donde la soltaste, no
    // saltar a la posición vieja hasta que vuelva el refetch.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: tablesKey })
      const previous = queryClient.getQueryData(tablesKey)
      queryClient.setQueryData(tablesKey, (current) =>
        current?.map((table) => (table.id === id ? { ...table, ...patch } : table)),
      )
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(tablesKey, context.previous)
    },
    onSettled: refresh,
  }))

  const patch = (id: string, changes: TablePatch) => patchTable.mutate({ id, patch: changes })

  function moveTable(tableId: string, x: number, y: number) {
    patch(tableId, { position_x: x, position_y: y })
  }

  /**
   * Cambiar el tamaño puede sacar la mesa de la grilla, así que la posición se
   * recalcula junto con la huella nueva.
   */
  function resizeTable(table: FloorTable, span: TableSpan) {
    patch(table.id, resizePlacement(table, span))
  }

  /**
   * Mueve una mesa a un sector. Conservar su posición anterior la dejaría encima
   * de otra mesa del destino, así que entra en el primer hueco libre.
   */
  function placeInSection(table: FloorTable, sectionId: string | null) {
    if (!sectionId) {
      patch(table.id, { section_id: null })
      return
    }
    const { x, y } = findFreeCell(tableFootprint(table), occupiedBy(floor.tablesIn(sectionId), table.id))
    patch(table.id, { section_id: sectionId, position_x: x, position_y: y })
  }

  /** Traduce una intención del inspector a la operación que le corresponde. */
  function applyIntent(table: FloorTable, intent: TableIntent) {
    switch (intent.kind) {
      case 'resize':
        return resizeTable(table, intent)
      case 'move-to-section':
        return placeInSection(table, intent.sectionId)
      case 'edit':
        return patch(table.id, intent.patch)
    }
  }

  return {
    errors,
    addSection,
    patchSection,
    removeSection,
    addTable,
    removeTable,
    moveTable,
    resizeTable,
    placeInSection,
    applyIntent,
  }
}

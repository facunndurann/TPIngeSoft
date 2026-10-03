import { queryOptions } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@restaurant-platform/shared'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export type FloorSection = Tables<'floor_sections'>
export type FloorTable = Tables<'tables'>

/**
 * Raíz de la caché del salón de una sucursal. Salón y Mesas y QR leen estas
 * mismas consultas, así que lo que cambia una pantalla lo ve la otra sin
 * invalidaciones cruzadas.
 */
export const floorKey = (branchId: string) => ['floor', branchId] as const

export const sectionsQuery = (branchId: string) =>
  queryOptions({
    queryKey: [...floorKey(branchId), 'sections'] as const,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('floor_sections')
          .select('*')
          .eq('branch_id', branchId)
          .order('sort_order')
          .order('created_at'),
      ),
  })

/** Todas las mesas de la sucursal, con o sin sector, en el orden del mapa del POS. */
export const tablesQuery = (branchId: string) =>
  queryOptions({
    queryKey: [...floorKey(branchId), 'tables'] as const,
    queryFn: async () =>
      unwrap(await supabase.from('tables').select('*').eq('branch_id', branchId).order('label')),
  })

export type SectionPatch = Partial<Pick<FloorSection, 'name' | 'is_active' | 'sort_order'>>

/**
 * Sin `section_id` ni posición, la mesa queda sin sector hasta que se la ubica en
 * el plano. Devuelve el id de la mesa creada, para elegirla en el plano.
 */
export async function createTable(table: TablesInsert<'tables'>) {
  return unwrap(await supabase.from('tables').insert(table).select('id').single()).id
}

/**
 * Las columnas de una mesa que el panel escribe. `TablePatch` sale de esta lista,
 * así quien necesita recorrerlas (deshacer, por ejemplo) lo hace con sus tipos.
 */
export const tablePatchColumns = [
  'section_id',
  'position_x',
  'position_y',
  'seats',
  'shape',
  'width',
  'height',
  'is_visible',
  'is_active',
  'label',
] as const

export type TablePatch = Partial<Pick<FloorTable, (typeof tablePatchColumns)[number]>>

/** Las columnas de un sector que se editan en el Salón. */
export const sectionPatchColumns = ['name', 'sort_order', 'is_active'] as const

/**
 * Lo que cambió en una edición del Salón, como lo recibe `save_floor`: lo nuevo
 * entero (con el id que le puso el editor), de lo modificado solo las columnas
 * que cambiaron, y los ids de lo borrado.
 */
export type FloorChanges = {
  sections: {
    create: Pick<FloorSection, 'id' | (typeof sectionPatchColumns)[number]>[]
    update: (SectionPatch & { id: string })[]
    delete: string[]
  }
  tables: {
    create: Pick<FloorTable, 'id' | (typeof tablePatchColumns)[number]>[]
    update: (TablePatch & { id: string })[]
    delete: string[]
  }
}

/** Guarda de una vez, en una sola transacción, todo lo que cambió en el Salón de una sucursal. */
export async function saveFloor(branchId: string, changes: FloorChanges) {
  unwrap(await supabase.rpc('save_floor', { p_branch_id: branchId, p_changes: changes }))
}

export async function updateTable(tableId: string, patch: TablePatch) {
  unwrap(await supabase.from('tables').update(patch).eq('id', tableId))
}

export async function deleteTable(tableId: string) {
  unwrap(await supabase.from('tables').delete().eq('id', tableId))
}

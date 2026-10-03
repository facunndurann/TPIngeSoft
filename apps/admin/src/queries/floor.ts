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

/** Devuelve el id del sector creado, para abrirlo. */
export async function createSection(section: TablesInsert<'floor_sections'>) {
  return unwrap(await supabase.from('floor_sections').insert(section).select('id').single()).id
}

export type SectionPatch = Partial<Pick<FloorSection, 'name' | 'is_active' | 'sort_order'>>

export async function updateSection(sectionId: string, patch: SectionPatch) {
  unwrap(await supabase.from('floor_sections').update(patch).eq('id', sectionId))
}

export async function deleteSection(sectionId: string) {
  unwrap(await supabase.from('floor_sections').delete().eq('id', sectionId))
}

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

export async function updateTable(tableId: string, patch: TablePatch) {
  unwrap(await supabase.from('tables').update(patch).eq('id', tableId))
}

export async function deleteTable(tableId: string) {
  unwrap(await supabase.from('tables').delete().eq('id', tableId))
}

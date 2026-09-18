import type { Tables } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export type FloorSection = Tables<'floor_sections'>
export type FloorTable = Tables<'tables'>

/**
 * Traduce los errores del schema a algo que el administrador entienda. Los dos
 * que importan son las restricciones de unicidad de MI-66.
 */
export class FloorError extends Error {
  constructor(raw: string) {
    super(
      raw.includes('floor_sections_branch_id_name_key')
        ? 'Ya existe un sector con ese nombre en esta sucursal.'
        : raw.includes('tables_label_unique_per_branch')
          ? 'Ya existe una mesa con ese identificador en esta sucursal.'
          : raw.includes('tables_section_same_branch')
            ? 'El sector pertenece a otra sucursal.'
            : raw,
    )
  }
}

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new FloorError(error.message)
  return data
}

export async function loadBranches(restaurantId: string) {
  return unwrap(
    await supabase
      .from('branches')
      .select('id, name, is_active')
      .eq('restaurant_id', restaurantId)
      .order('created_at'),
  )
}

export async function loadSections(branchId: string) {
  return unwrap(
    await supabase
      .from('floor_sections')
      .select('*')
      .eq('branch_id', branchId)
      .order('sort_order')
      .order('created_at'),
  ) as FloorSection[]
}

export async function loadTables(branchId: string) {
  return unwrap(
    await supabase.from('tables').select('*').eq('branch_id', branchId).order('label'),
  ) as FloorTable[]
}

export async function createSection(input: {
  restaurantId: string
  branchId: string
  name: string
  sortOrder: number
}) {
  return unwrap(
    await supabase
      .from('floor_sections')
      .insert({
        restaurant_id: input.restaurantId,
        branch_id: input.branchId,
        name: input.name,
        sort_order: input.sortOrder,
      })
      .select()
      .single(),
  ) as FloorSection
}

export async function updateSection(
  sectionId: string,
  patch: Partial<Pick<FloorSection, 'name' | 'is_active' | 'sort_order'>>,
) {
  unwrap(await supabase.from('floor_sections').update(patch).eq('id', sectionId).select())
}

export async function deleteSection(sectionId: string) {
  unwrap(await supabase.from('floor_sections').delete().eq('id', sectionId).select())
}

export async function createTable(input: {
  restaurantId: string
  branchId: string
  sectionId: string | null
  label: string
  positionX: number
  positionY: number
}) {
  return unwrap(
    await supabase
      .from('tables')
      .insert({
        restaurant_id: input.restaurantId,
        branch_id: input.branchId,
        section_id: input.sectionId,
        label: input.label,
        position_x: input.positionX,
        position_y: input.positionY,
      })
      .select()
      .single(),
  ) as FloorTable
}

export type TableLayoutPatch = Partial<
  Pick<
    FloorTable,
    | 'section_id'
    | 'position_x'
    | 'position_y'
    | 'seats'
    | 'shape'
    | 'width'
    | 'height'
    | 'is_visible'
    | 'is_active'
    | 'label'
  >
>

export async function updateTableLayout(tableId: string, patch: TableLayoutPatch) {
  unwrap(await supabase.from('tables').update(patch).eq('id', tableId).select())
}

export async function deleteTable(tableId: string) {
  unwrap(await supabase.from('tables').delete().eq('id', tableId).select())
}

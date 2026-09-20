import { fromPostgres, type Tables } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export type FloorSection = Tables<'floor_sections'>
export type FloorTable = Tables<'tables'>

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  // Los nombres de constraint de MI-66 ya están en el catálogo compartido.
  if (error) throw fromPostgres(error)
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

/**
 * Lo que el inspector le pide al plano. Son tres operaciones con semántica
 * propia — redimensionar recalcula la posición, mudar de sector busca un hueco
 * libre, editar es un update plano — así que viajan discriminadas en vez de
 * como un `Partial<>` suelto cuyas claves haya que olfatear del otro lado.
 */
export type TableIntent =
  | { kind: 'edit'; patch: Omit<TableLayoutPatch, 'section_id' | 'width' | 'height'> }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'move-to-section'; sectionId: string | null }

export async function updateTableLayout(tableId: string, patch: TableLayoutPatch) {
  unwrap(await supabase.from('tables').update(patch).eq('id', tableId).select())
}

export async function deleteTable(tableId: string) {
  unwrap(await supabase.from('tables').delete().eq('id', tableId).select())
}

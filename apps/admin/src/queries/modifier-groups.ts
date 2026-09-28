import { queryOptions } from '@tanstack/react-query'
import type { QueryData } from '@supabase/supabase-js'
import { groupPayload, type ModifierGroupDraft } from '@/features/modifier-group-draft'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

const modifierGroupsOf = (restaurantId: string) =>
  supabase
    .from('modifier_groups')
    .select('*, modifier_options(*)')
    .eq('restaurant_id', restaurantId)
    .order('created_at')
    .order('sort_order', { referencedTable: 'modifier_options' })

export type ModifierGroupWithOptions = QueryData<ReturnType<typeof modifierGroupsOf>>[number]

/** Grupos con sus opciones. Una sola forma por key: quien no usa las opciones igual las recibe. */
export const modifierGroupsQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: ['modifier-groups', restaurantId],
    queryFn: async () => unwrap(await modifierGroupsOf(restaurantId)),
  })

/**
 * Guarda el grupo y su lista completa de opciones, en orden, en una transacción
 * (`save_modifier_group`): las opciones que ya no están en la lista se borran.
 */
export async function saveModifierGroup(input: {
  restaurantId: string
  /** Ausente al crear. */
  groupId?: string
  draft: ModifierGroupDraft
}) {
  const payload = groupPayload(input.draft)
  if (!payload) throw new Error('El grupo no es válido')

  unwrap(
    await supabase.rpc('save_modifier_group', {
      p_restaurant_id: input.restaurantId,
      p_group_id: input.groupId,
      p_name: payload.name,
      p_min_select: payload.minSelect,
      p_max_select: payload.maxSelect,
      p_is_available: payload.isAvailable,
      p_options: payload.options,
    }),
  )
}

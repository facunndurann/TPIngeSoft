import { queryOptions } from '@tanstack/react-query'
import type { QueryData } from '@supabase/supabase-js'
import { supabase, unwrap } from '@/lib/supabase'

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

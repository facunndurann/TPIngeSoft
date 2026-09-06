import type { Tables } from '@restaurant-platform/shared'

export type PosOrderItem = Tables<'order_items'> & {
  order_item_modifiers: Tables<'order_item_modifiers'>[]
  order_item_removed_ingredients: Tables<'order_item_removed_ingredients'>[]
}

export type PosTableRef = Pick<Tables<'tables'>, 'id' | 'label' | 'branch_id'> & {
  branch: Pick<Tables<'branches'>, 'id' | 'name'> | null
}

export type PosSessionRef = Pick<
  Tables<'table_sessions'>,
  'id' | 'status' | 'opened_at' | 'closed_at' | 'table_id'
> & {
  tables: PosTableRef
  session_participants: Pick<Tables<'session_participants'>, 'id' | 'display_name' | 'joined_at'>[]
}

export type PosOrder = Tables<'orders'> & {
  order_items: PosOrderItem[]
  table_sessions: PosSessionRef
}

export type PosOpenSession = Tables<'table_sessions'> & {
  tables: PosTableRef
  session_participants: Pick<Tables<'session_participants'>, 'id' | 'display_name' | 'joined_at'>[]
}

export type PosBill = Tables<'session_bills'>

export type PosDiningTable = Pick<Tables<'tables'>, 'id' | 'label' | 'branch_id' | 'is_active'> & {
  branches: Pick<Tables<'branches'>, 'id' | 'name'> | null
}

export const posOrderSelect = `
  *,
  order_items (
    *,
    order_item_modifiers (*),
    order_item_removed_ingredients (*)
  ),
  table_sessions!inner (
    id,
    status,
    opened_at,
    closed_at,
    table_id,
    session_participants (id, display_name, joined_at),
    tables!inner (
      id,
      label,
      branch_id,
      branch:branches (id, name)
    )
  )
` as const

export const posSessionSelect = `
  *,
  session_participants (id, display_name, joined_at),
  tables!inner (
    id,
    label,
    branch_id,
    branch:branches (id, name)
  )
` as const

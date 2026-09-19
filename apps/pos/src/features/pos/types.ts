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
  assigned_employee: Pick<Tables<'profiles'>, 'id' | 'full_name'> | null
  orders: Pick<Tables<'orders'>, 'id' | 'status'>[]
  payments: Pick<Tables<'payments'>, 'id' | 'status'>[]
}

export type PosBill = Tables<'session_bills'>

export type PosDiningTable = Pick<
  Tables<'tables'>,
  | 'id'
  | 'label'
  | 'branch_id'
  | 'is_active'
  | 'is_visible'
  | 'section_id'
  | 'position_x'
  | 'position_y'
  | 'seats'
  | 'shape'
  | 'width'
  | 'height'
> & {
  branches: Pick<Tables<'branches'>, 'id' | 'name' | 'is_active'> | null
  floor_sections: Pick<Tables<'floor_sections'>, 'id' | 'name' | 'sort_order' | 'is_active'> | null
}

export type PosFloorSection = Pick<
  Tables<'floor_sections'>,
  'id' | 'name' | 'branch_id' | 'sort_order' | 'is_active'
> & {
  branches: Pick<Tables<'branches'>, 'id' | 'name' | 'is_active'> | null
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
  assigned_employee:profiles!table_sessions_assigned_user_id_fkey (id, full_name),
  orders (id, status),
  payments (id, status),
  tables!inner (
    id,
    label,
    branch_id,
    branch:branches (id, name)
  )
` as const

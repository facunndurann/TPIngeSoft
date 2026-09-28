/**
 * Un pedido como lo lee el POS: ítems, cuenta, comensales y mesa. El tablero y
 * el historial muestran toda cuenta de la sucursal, tenga o no mesa: la mesa no
 * es !inner (una cuenta para llevar no tiene) y la sucursal sale de la cuenta.
 * Para nombrar la cuenta: `sessionPlaceLabel`.
 *
 * Vive aparte de queries.ts, sin Vite ni el cliente de Supabase, para que la
 * suite integrada (supabase/tests/orders.integration.mjs) pruebe este mismo
 * select contra la base: si un embed deja de existir, falla ahí y no en el POS.
 */
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
    kind,
    branch_id,
    session_participants (id, display_name, joined_at),
    tables (
      id,
      label,
      branch_id
    )
  )
` as const

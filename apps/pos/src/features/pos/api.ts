import type { OrderStatus } from '@restaurant-platform/shared'
import { isOperable, posErrorMessage } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import type { PosBill, PosDiningTable, PosFloorSection, PosOpenSession, PosOrder } from './types'
import { posOrderSelect, posSessionSelect } from './types'

export class PosActionError extends Error {
  constructor(message: string) {
    super(posErrorMessage(message))
  }
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new PosActionError(error.message)
}

export async function loadBoardOrders(restaurantId: string, branchId: string, deliveredSinceIso: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('restaurant_id', restaurantId)
    .eq('table_sessions.tables.branch_id', branchId)
    .or(
      `status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,created_at.gte."${deliveredSinceIso}")`,
    )
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as PosOrder[]
}

export async function loadDayOrders(restaurantId: string, branchId: string, startIso: string, endIso: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('restaurant_id', restaurantId)
    .eq('table_sessions.tables.branch_id', branchId)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as PosOrder[]
}

export async function loadOpenSessions(restaurantId: string, branchId: string) {
  const { data, error } = await supabase
    .from('table_sessions')
    .select(posSessionSelect)
    .eq('restaurant_id', restaurantId)
    .eq('tables.branch_id', branchId)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })
  throwIfError(error)
  return (data ?? []) as PosOpenSession[]
}

export async function loadSessionBills(sessionIds: string[]) {
  if (sessionIds.length === 0) return [] as PosBill[]
  const { data, error } = await supabase
    .from('session_bills')
    .select('*')
    .in('session_id', sessionIds)
  throwIfError(error)
  return (data ?? []) as PosBill[]
}

/**
 * Mesas que el POS puede operar. Quedan afuera las que están fuera de servicio,
 * las ocultas del plano y las de un sector que el local dio de baja (MI-66).
 * Una mesa sin sector sigue siendo operable: existe y tiene QR.
 */
export async function loadRestaurantTables(restaurantId: string, branchId: string) {
  const { data, error } = await supabase
    .from('tables')
    .select(
      'id, label, branch_id, is_active, is_visible, section_id, position_x, position_y, seats, shape, width, height, branches (id, name, is_active), floor_sections (id, name, sort_order, is_active)',
    )
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .eq('is_visible', true)
    .order('label')
  throwIfError(error)
  // El sector se filtra acá: PostgREST no expresa "sin sector o sector activo"
  // sin forzar un inner join que descartaría las mesas sin sector.
  return ((data ?? []) as PosDiningTable[]).filter(
    (table) => table.branches?.is_active === true && isOperable(table, table.floor_sections),
  )
}

/** Sectores activos que el POS puede recorrer, incluso si todavía están vacíos. */
export async function loadPosFloorSections(restaurantId: string, branchId: string) {
  const { data, error } = await supabase
    .from('floor_sections')
    .select('id, name, branch_id, sort_order, is_active, branches (id, name, is_active)')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  throwIfError(error)
  return ((data ?? []) as PosFloorSection[]).filter(
    (section) => section.branches?.is_active === true,
  )
}

// Los envoltorios pos_* validan igual que transition_order/close_table_session
// y además dejan la acción asociada al empleado que opera (MI-61).
export async function transitionPosOrder(
  orderId: string,
  status: OrderStatus,
) {
  const { error } = await supabase.rpc('pos_transition_order', {
    p_order_id: orderId,
    p_status: status,
  })
  throwIfError(error)
}

/**
 * Abre la comanda de una mesa, o devuelve la que ya estaba abierta (MI-64).
 * Es la misma llamada para "abrir" y para "continuar": la RPC es idempotente,
 * así que dos mozos sobre la misma mesa terminan en la misma sesión.
 */
export async function openPosTableSession(tableId: string) {
  const { data, error } = await supabase.rpc('pos_open_table_session', {
    p_table_id: tableId,
  })
  throwIfError(error)
  if (!data) throw new PosActionError('SESSION_NOT_FOUND')
  return data as string
}

/** Comanda completa de una mesa: la sesión abierta con sus pedidos y su cuenta. */
export async function loadTableSession(tableId: string) {
  const { data, error } = await supabase
    .from('table_sessions')
    .select(posSessionSelect)
    .eq('table_id', tableId)
    .eq('status', 'open')
    .maybeSingle()
  throwIfError(error)
  return (data ?? null) as PosOpenSession | null
}

export async function loadSessionOrders(sessionId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as PosOrder[]
}

export async function closePosSession(sessionId: string) {
  const { error } = await supabase.rpc('pos_close_table_session', {
    p_session_id: sessionId,
  })
  throwIfError(error)
}

/** Traslada la misma sesión; el origen esperado protege contra un plano desactualizado. */
export async function movePosTableSession(
  sessionId: string,
  sourceTableId: string,
  destinationTableId: string,
) {
  const { error } = await supabase.rpc('pos_move_table_session', {
    p_session_id: sessionId,
    p_source_table_id: sourceTableId,
    p_destination_table_id: destinationTableId,
  })
  throwIfError(error)
}

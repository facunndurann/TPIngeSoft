import type { OrderStatus } from '@restaurant-platform/shared'
import { isOperable, posErrorMessage } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import type { PosBill, PosDiningTable, PosOpenSession, PosOrder } from './types'
import { posOrderSelect, posSessionSelect } from './types'

export class PosActionError extends Error {
  constructor(message: string) {
    super(posErrorMessage(message))
  }
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new PosActionError(error.message)
}

export async function loadBoardOrders(restaurantId: string, deliveredSinceIso: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('restaurant_id', restaurantId)
    .or(
      `status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,created_at.gte."${deliveredSinceIso}")`,
    )
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as PosOrder[]
}

export async function loadDayOrders(restaurantId: string, startIso: string, endIso: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('restaurant_id', restaurantId)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as PosOrder[]
}

export async function loadOpenSessions(restaurantId: string) {
  const { data, error } = await supabase
    .from('table_sessions')
    .select(posSessionSelect)
    .eq('restaurant_id', restaurantId)
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
export async function loadRestaurantTables(restaurantId: string) {
  const { data, error } = await supabase
    .from('tables')
    .select(
      'id, label, branch_id, is_active, is_visible, section_id, position_x, position_y, seats, shape, width, height, branches (id, name), floor_sections (id, name, sort_order, is_active)',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .eq('is_visible', true)
    .order('label')
  throwIfError(error)
  // El sector se filtra acá: PostgREST no expresa "sin sector o sector activo"
  // sin forzar un inner join que descartaría las mesas sin sector.
  return ((data ?? []) as PosDiningTable[]).filter((table) =>
    isOperable(table, table.floor_sections),
  )
}

// Los envoltorios pos_* validan igual que transition_order/close_table_session
// y además dejan la acción asociada al empleado que opera (MI-61).
export async function transitionPosOrder(
  orderId: string,
  status: OrderStatus,
  employeeId: string | null,
) {
  const { error } = await supabase.rpc('pos_transition_order', {
    p_order_id: orderId,
    p_status: status,
    // omitir = null en la RPC: la acción queda solo con el usuario del dispositivo
    p_employee_id: employeeId ?? undefined,
  })
  throwIfError(error)
}

export async function closePosSession(sessionId: string, employeeId: string | null) {
  const { error } = await supabase.rpc('pos_close_table_session', {
    p_session_id: sessionId,
    p_employee_id: employeeId ?? undefined,
  })
  throwIfError(error)
}

import type { OrderStatus } from '@restaurant-platform/shared'
import { appErrorMessage } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import type { PosBill, PosDiningTable, PosOpenSession, PosOrder } from './types'
import { posOrderSelect, posSessionSelect } from './types'

export class PosActionError extends Error {
  constructor(message: string) {
    super(appErrorMessage(message, 'No pudimos completar la acción. Reintentá.'))
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

export async function loadRestaurantTables(restaurantId: string) {
  const { data, error } = await supabase
    .from('tables')
    .select('id, label, branch_id, is_active, branches (id, name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at')
  throwIfError(error)
  return (data ?? []) as PosDiningTable[]
}

export async function transitionPosOrder(orderId: string, status: OrderStatus) {
  const { error } = await supabase.rpc('transition_order', {
    p_order_id: orderId,
    p_status: status,
  })
  throwIfError(error)
}

export async function closePosSession(sessionId: string) {
  const { error } = await supabase.rpc('close_table_session', { p_session_id: sessionId })
  throwIfError(error)
}

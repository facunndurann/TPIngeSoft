import { queryOptions } from '@tanstack/react-query'
import type { QueryData } from '@supabase/supabase-js'
import { appErrorMessage, dayRangeUtc, localDateKey, type OrderStatus, type Tables } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export class PosActionError extends Error {
  constructor(message: string) {
    super(appErrorMessage(message, 'No pudimos completar la acción. Reintentá.'))
  }
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new PosActionError(error.message)
}

async function rowsOf<Row>(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query
  throwIfError(error)
  return data ?? []
}

// Los tipos de las filas salen de los selects (supabase-js los infiere del string),
// así que un cambio en las columnas pedidas se refleja en todos los componentes.
const ordersOf = (restaurantId: string) =>
  supabase
    .from('orders')
    .select('*, order_items(*, order_item_modifiers(*), order_item_removed_ingredients(*)), table_sessions!inner(id, status, opened_at, closed_at, table_id, session_participants(id, display_name, joined_at), tables!inner(id, label, branch_id, branch:branches(id, name)))')
    .eq('restaurant_id', restaurantId)

const openSessionsOf = (restaurantId: string) =>
  supabase
    .from('table_sessions')
    .select('*, session_participants(id, display_name, joined_at), tables!inner(id, label, branch_id, branch:branches(id, name))')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })

const diningTablesOf = (restaurantId: string) =>
  supabase
    .from('tables')
    .select('id, label, branch_id, is_active, branches(id, name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at')

export type PosOrder = QueryData<ReturnType<typeof ordersOf>>[number]
export type PosOrderItem = PosOrder['order_items'][number]
export type PosOpenSession = QueryData<ReturnType<typeof openSessionsOf>>[number]
export type PosDiningTable = QueryData<ReturnType<typeof diningTablesOf>>[number]
export type PosBill = Tables<'session_bills'>

/** Raíz de las queries del POS: invalidarla refresca tablero, mesas e historial. */
export const posQueryKey = (restaurantId: string) => ['pos', restaurantId] as const

/** Comandas activas y las entregadas hoy (día del restaurante). */
export const posBoardQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'board'],
    queryFn: () =>
      rowsOf(
        ordersOf(restaurantId)
          .or(`status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,created_at.gte."${dayRangeUtc(localDateKey()).start}")`)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: 15_000,
  })

export const posHistoryQuery = (restaurantId: string, dateKey: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'history', dateKey],
    queryFn: () => {
      const { start, end } = dayRangeUtc(dateKey)
      return rowsOf(
        ordersOf(restaurantId)
          .gte('created_at', start)
          .lt('created_at', end)
          .order('created_at', { ascending: false }),
      )
    },
    refetchInterval: 15_000,
  })

export const posOpenSessionsQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'sessions'],
    queryFn: () => rowsOf(openSessionsOf(restaurantId)),
    refetchInterval: 15_000,
  })

export const posBillsQuery = (restaurantId: string, sessionIds: string[]) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'bills', sessionIds],
    queryFn: async (): Promise<PosBill[]> =>
      sessionIds.length === 0
        ? []
        : rowsOf(supabase.from('session_bills').select('*').in('session_id', sessionIds)),
    refetchInterval: 15_000,
  })

export const posDiningTablesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'tables'],
    queryFn: () => rowsOf(diningTablesOf(restaurantId)),
  })

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

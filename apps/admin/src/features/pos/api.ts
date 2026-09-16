import { queryOptions } from '@tanstack/react-query'
import type { QueryData } from '@supabase/supabase-js'
import { appErrorMessage, type OrderStatus, type Tables } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { localDateKey } from './time'

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

/**
 * Fila de la vista pos_open_sessions: sesión abierta con mesa, sucursal, comensales,
 * cuenta y comandas en cocina. Postgres no propaga NOT NULL a las columnas de una
 * vista y los tipos generados las marcan nullables; esta vista nunca devuelve null
 * (joins internos, coalesce y count), así que se declaran requeridas.
 */
export type PosOpenSession = {
  [Column in keyof Tables<'pos_open_sessions'>]-?: NonNullable<Tables<'pos_open_sessions'>[Column]>
}

const openSessionsOf = (restaurantId: string) =>
  supabase
    .from('pos_open_sessions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('opened_at', { ascending: true })
    .overrideTypes<PosOpenSession[], { merge: false }>()

// El spread aplana la sucursal a branch_name, la misma columna que expone
// pos_open_sessions: así mesas libres y ocupadas se agrupan con la misma función.
const diningTablesOf = (restaurantId: string) =>
  supabase
    .from('tables')
    .select('id, label, is_active, ...branches(branch_name:name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at')

export type PosOrder = QueryData<ReturnType<typeof ordersOf>>[number]
export type PosOrderItem = PosOrder['order_items'][number]
export type PosDiningTable = QueryData<ReturnType<typeof diningTablesOf>>[number]

/** Raíz de las queries del POS: invalidarla refresca tablero, mesas e historial. */
export const posQueryKey = (restaurantId: string) => ['pos', restaurantId] as const

/** Comandas activas y las entregadas hoy (día del restaurante). */
export const posBoardQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'board'],
    queryFn: () =>
      rowsOf(
        ordersOf(restaurantId)
          .or(`status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,local_date.eq.${localDateKey()})`)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: 15_000,
  })

export const posHistoryQuery = (restaurantId: string, dateKey: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'history', dateKey],
    queryFn: () =>
      rowsOf(
        ordersOf(restaurantId)
          .eq('local_date', dateKey)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: 15_000,
  })

/** Mesas activas: una sola lectura de la vista, con cuenta y comandas en cocina. */
export const posOpenSessionsQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId), 'sessions'],
    queryFn: () => rowsOf(openSessionsOf(restaurantId)),
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

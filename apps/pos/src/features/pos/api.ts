import { queryOptions } from '@tanstack/react-query'
import type { OrderStatus, Tables } from '@restaurant-platform/shared'
import { isOperable, posErrorMessage } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { localDateKey } from './time'
import type { PosBill, PosDiningTable, PosFloorSection, PosOpenSession, PosOrder } from './types'
import { posOrderSelect, posSessionSelect } from './types'

export type { PosBill, PosDiningTable, PosFloorSection, PosOpenSession, PosOrder, PosOrderItem } from './types'

export class PosActionError extends Error {
  constructor(message: string) {
    super(posErrorMessage(message))
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

/** Raíz de las queries del POS en una sucursal. Invalidarla refresca tablero, mesas e historial. */
export const posQueryKey = (restaurantId: string, branchId: string) =>
  ['pos', restaurantId, branchId] as const

const ordersOf = (restaurantId: string, branchId: string) =>
  supabase
    .from('orders')
    .select(posOrderSelect)
    .eq('restaurant_id', restaurantId)
    .eq('table_sessions.tables.branch_id', branchId)

/** Comandas activas y las entregadas hoy (día del restaurante, columna local_date). */
export const posBoardQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'board'],
    queryFn: () =>
      rowsOf(
        ordersOf(restaurantId, branchId)
          .or(`status.in.(submitted,accepted,in_preparation,ready),and(status.eq.delivered,local_date.eq.${localDateKey()})`)
          .order('created_at', { ascending: false }),
      ) as Promise<PosOrder[]>,
    refetchInterval: 15_000,
  })

export const posHistoryQuery = (restaurantId: string, branchId: string, dateKey: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'history', dateKey],
    queryFn: () =>
      rowsOf(
        ordersOf(restaurantId, branchId)
          .eq('local_date', dateKey)
          .order('created_at', { ascending: false }),
      ) as Promise<PosOrder[]>,
    refetchInterval: 15_000,
  })

/**
 * Fila de la vista pos_open_sessions: sesión abierta con mesa, sucursal, comensales,
 * cuenta y comandas en cocina. Distinta de PosOpenSession (sesión completa del plano).
 */
export type PosOpenSessionCard = {
  [Column in keyof Tables<'pos_open_sessions'>]-?: NonNullable<Tables<'pos_open_sessions'>[Column]>
}

const openSessionCardsOf = (restaurantId: string, branchId: string) =>
  supabase
    .from('pos_open_sessions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    .order('opened_at', { ascending: true })
    .overrideTypes<PosOpenSessionCard[], { merge: false }>()

/** Mesas activas de la sucursal: una lectura de la vista, con cuenta y comandas en cocina. */
export const posOpenSessionsQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'session-cards'],
    queryFn: () => rowsOf(openSessionCardsOf(restaurantId, branchId)),
    refetchInterval: 15_000,
  })

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
 * Mesas que el POS puede operar en la sucursal. Quedan afuera las que están
 * fuera de servicio, las ocultas del plano y las de un sector dado de baja.
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

export async function transitionPosOrder(orderId: string, status: OrderStatus) {
  const { error } = await supabase.rpc('pos_transition_order', {
    p_order_id: orderId,
    p_status: status,
  })
  throwIfError(error)
}

/**
 * Abre la comanda de una mesa, o devuelve la que ya estaba abierta (MI-64).
 * La RPC es idempotente y usa la cuenta autenticada, no un PIN.
 */
export async function openPosTableSession(tableId: string) {
  const { data, error } = await supabase.rpc('pos_open_table_session', {
    p_table_id: tableId,
  })
  throwIfError(error)
  if (!data) throw new PosActionError('SESSION_NOT_FOUND')
  return data as string
}

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

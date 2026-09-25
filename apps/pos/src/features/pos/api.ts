import { queryOptions } from '@tanstack/react-query'
import { AppError, fromPostgres, isOperable, kitchenTicketStatuses, localDateKey, type OrderStatus, type PaymentMethod, type PaymentMode, type SessionRequestKind, type Tables } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import type { PosDiningTable, PosFloorSection, PosOrder } from './types'
import { posOrderSelect } from './types'

export type { PosDiningTable, PosFloorSection, PosOrder, PosOrderItem } from './types'

function throwIfError(error: { message: string } | null): void {
  // fromPostgres conserva el código, así que quien llama puede ramificar.
  if (error) throw fromPostgres(error)
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
          .or(`status.in.(${kitchenTicketStatuses.join(',')}),and(status.eq.delivered,local_date.eq.${localDateKey()})`)
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

type OpenSessionRow = Tables<'pos_open_sessions'>

/**
 * Columnas de la vista cuyo null significa algo. El generador marca todas las
 * columnas de una vista como nullable; de verdad lo son solo estas:
 * - las solicitudes: la mesa no pidió, o no se atendió;
 * - los importes: salen de `session_bills`, que solo tiene fila para quien
 *   tiene `payments.read`. Son null los cuatro juntos, y null es «no se puede
 *   ver», no «debe $0»;
 * - el responsable: nadie tiene la mesa asignada.
 */
type NullableOpenSessionColumn =
  | 'bill_requested_at'
  | 'bill_attended_at'
  | 'in_person_payment_requested_at'
  | 'in_person_payment_attended_at'
  | 'submitted_amount'
  | 'total_amount'
  | 'paid_amount'
  | 'pending_amount'
  | 'assigned_employee_name'

/**
 * Sesión abierta tal como la lee todo el POS (plano, comanda, mesas activas y
 * traslado): una fila de `pos_open_sessions` con mesa, comensales, cuenta,
 * solicitudes, responsable y comandas en cocina.
 */
export type PosOpenSession = {
  [Column in Exclude<keyof OpenSessionRow, NullableOpenSessionColumn>]-?: NonNullable<OpenSessionRow[Column]>
} & { [Column in NullableOpenSessionColumn]: NonNullable<OpenSessionRow[Column]> | null }

const openSessionsOf = (restaurantId: string, branchId: string) =>
  supabase
    .from('pos_open_sessions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    .order('opened_at', { ascending: true })
    .overrideTypes<PosOpenSession[], { merge: false }>()

/**
 * Mesas abiertas de la sucursal: la única lectura de sesiones del POS. Todas
 * las pantallas comparten esta key, así que un cambio refresca a todas juntas.
 */
export const posOpenSessionsQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'open-sessions'],
    queryFn: () => rowsOf(openSessionsOf(restaurantId, branchId)),
    refetchInterval: 15_000,
  })

export async function loadSessionPayments(sessionId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, participant_id, amount, mode, method, status, external_reference, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return data ?? []
}

export async function recordPosPayment(input: {
  sessionId: string
  amount: number
  method: PaymentMethod
  mode: PaymentMode
  externalReference?: string
}) {
  const { data, error } = await supabase.rpc('pos_record_payment', {
    p_session_id: input.sessionId,
    p_amount: input.amount,
    p_method: input.method,
    p_mode: input.mode,
    p_external_reference: input.externalReference || undefined,
  })
  throwIfError(error)
  return data
}

/**
 * Mesas que el POS puede operar en la sucursal. Quedan afuera las que están
 * fuera de servicio, las ocultas del plano y las de un sector dado de baja.
 */
export async function loadRestaurantTables(restaurantId: string, branchId: string) {
  const { data, error } = await supabase
    .from('tables')
    .select(
      'id, label, branch_id, is_active, is_visible, section_id, position_x, position_y, seats, shape, width, height, branches (id, name, is_active, payment_methods), floor_sections (id, name, sort_order, is_active)',
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
  if (!data) throw new AppError('SESSION_NOT_FOUND')
  return data as string
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

/**
 * Marca atendida la solicitud de una mesa (MI-47). Idempotente: si otro mozo se
 * adelantó, la RPC devuelve null y no audita una atención de más.
 */
export async function resolvePosSessionRequest(sessionId: string, kind: SessionRequestKind) {
  const { error } = await supabase.rpc('pos_resolve_session_request', {
    p_session_id: sessionId,
    p_kind: kind,
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
